package kr.co.krs.meetingnotes;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;

import java.io.File;

/**
 * 녹음 서비스: 화면을 끄거나 다른 앱으로 가도 녹음이 이어지게, 알림("회의 녹음 중")을 띄운 채 녹음한다.
 * 녹음 파일은 앱 안쪽 폴더(files/recordings)에 AAC(m4a)로 저장한다. 상태는 RecPlugin이 이 클래스의 static 값으로 읽는다.
 */
public class RecorderService extends Service {
    static final String CHANNEL = "recording";
    static final int NOTIFY_ID = 1;

    static volatile String state = "idle";          // idle · recording · paused
    static volatile String path = null;
    static volatile String error = null;
    static volatile long startedAt = 0, pausedTotal = 0, pausedAt = 0;
    private static MediaRecorder recorder;
    private static PowerManager.WakeLock wake;
    private static RecorderService instance;

    static synchronized long elapsed() {
        if ("idle".equals(state)) return 0;
        long now = SystemClock.elapsedRealtime();
        return now - startedAt - pausedTotal - (pausedAt > 0 ? now - pausedAt : 0);
    }

    static synchronized double level() {
        if (recorder == null || !"recording".equals(state)) return 0;
        try { return recorder.getMaxAmplitude() / 32767.0; } catch (Exception e) { return 0; }
    }

    static void start(Context ctx, String file) {
        error = null;
        Intent i = new Intent(ctx, RecorderService.class).setAction("start").putExtra("path", file);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
    }

    static synchronized void pause() {
        if (recorder == null || !"recording".equals(state)) return;
        recorder.pause();
        pausedAt = SystemClock.elapsedRealtime();
        state = "paused";
        if (instance != null) instance.notifyState();
    }

    static synchronized void resume() {
        if (recorder == null || !"paused".equals(state)) return;
        recorder.resume();
        pausedTotal += SystemClock.elapsedRealtime() - pausedAt;
        pausedAt = 0;
        state = "recording";
        if (instance != null) instance.notifyState();
    }

    /** 멈추고 저장한다. 녹음 길이(ms)를 돌려준다. 너무 짧아 저장할 것이 없으면 예외 */
    static synchronized long stop() throws Exception {
        if (recorder == null) throw new Exception("녹음 중이 아닙니다");
        long ms = elapsed();
        Exception fail = null;
        try { recorder.stop(); } catch (Exception e) { fail = new Exception("녹음이 너무 짧아 저장할 것이 없습니다"); }
        recorder.release();
        recorder = null;
        state = "idle";
        if (wake != null && wake.isHeld()) wake.release();
        if (instance != null) { instance.stopForeground(true); instance.stopSelf(); }
        if (fail != null) { if (path != null) new File(path).delete(); throw fail; }
        return ms;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        instance = this;
        if (intent == null || !"start".equals(intent.getAction())) return START_NOT_STICKY;
        // 앞에 알림부터 (안드로이드는 몇 초 안에 알림을 띄우지 않으면 서비스를 멈춘다)
        Notification n = build("회의 녹음 중", true);
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFY_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        else startForeground(NOTIFY_ID, n);
        synchronized (RecorderService.class) {
            try {
                String file = intent.getStringExtra("path");
                MediaRecorder r = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
                r.setAudioSource(MediaRecorder.AudioSource.MIC);
                r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                r.setAudioChannels(1);
                r.setAudioSamplingRate(44100);
                r.setAudioEncodingBitRate(64000);       // 1시간 ≈ 29MB
                r.setOutputFile(file);
                r.prepare();
                r.start();
                recorder = r;
                path = file;
                startedAt = SystemClock.elapsedRealtime();
                pausedTotal = 0;
                pausedAt = 0;
                state = "recording";
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "meetingnotes:recording");
                wake.acquire(12 * 60 * 60 * 1000L);     // 길어도 12시간
            } catch (Exception e) {
                error = "마이크를 열지 못했습니다 (" + e.getMessage() + ")";
                if (recorder != null) { recorder.release(); recorder = null; }
                state = "idle";
                stopForeground(true);
                stopSelf();
            }
        }
        return START_NOT_STICKY;
    }

    private void notifyState() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(NOTIFY_ID, build("paused".equals(state) ? "회의 녹음 일시 정지" : "회의 녹음 중", "recording".equals(state)));
    }

    private Notification build(String title, boolean running) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "녹음", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("녹음하는 동안 보이는 알림");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setContentTitle(title)
            .setContentText("눌러서 회의록 앱 열기")
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setContentIntent(pi)
            .setOngoing(true)
            .setOnlyAlertOnce(true);
        if (running) {
            // 알림의 시계: 일시 정지한 시간을 뺀 녹음 시간
            b.setUsesChronometer(true).setWhen(System.currentTimeMillis() - elapsed());
        }
        return b.build();
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
