package kr.co.krs.meetingnotes;

import android.Manifest;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.DhcpInfo;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 화면(www/app.js)이 쓰는 안드로이드 기능: 녹음 · PC로 보내기 · 같은 Wi-Fi의 PC 찾기 · 공유 · 브라우저 열기.
 * 오래 걸리는 일(보내기·찾기·받기)은 따로 일꾼 스레드에서 해서, 그동안에도 녹음 상태를 물을 수 있게 한다.
 */
@CapacitorPlugin(
    name = "Rec",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
    }
)
public class RecPlugin extends Plugin {
    private static final int DISCOVERY_PORT = 47214;
    private final ExecutorService work = Executors.newFixedThreadPool(3);

    private File recDir() {
        File d = new File(getContext().getFilesDir(), "recordings");
        d.mkdirs();
        return d;
    }

    // ---------- 권한 ----------

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED
            && (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") != PermissionState.PROMPT)) {
            checkPermissions(call);
            return;
        }
        String[] aliases = Build.VERSION.SDK_INT >= 33 ? new String[] { "microphone", "notifications" } : new String[] { "microphone" };
        requestPermissionForAliases(aliases, call, "permsDone");
    }

    @PermissionCallback
    private void permsDone(PluginCall call) { checkPermissions(call); }

    // ---------- 녹음 ----------

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) { call.reject("마이크 권한이 없습니다", "NO_MIC"); return; }
        if (!"idle".equals(RecorderService.state)) { call.reject("이미 녹음 중입니다"); return; }
        String file = new File(recDir(), "rec-" + System.currentTimeMillis() + ".m4a").getAbsolutePath();
        RecorderService.start(getContext(), file);
        // 서비스가 녹음을 시작했는지 잠깐 기다려 확인한다
        work.execute(() -> {
            for (int i = 0; i < 40; i++) {
                if (!"idle".equals(RecorderService.state)) { JSObject r = new JSObject(); r.put("path", file); call.resolve(r); return; }
                if (RecorderService.error != null) { call.reject(RecorderService.error); return; }
                try { Thread.sleep(100); } catch (InterruptedException ignored) { }
            }
            call.reject("녹음을 시작하지 못했습니다");
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        try { RecorderService.pause(); call.resolve(); } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void resume(PluginCall call) {
        try { RecorderService.resume(); call.resolve(); } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            String p = RecorderService.path;
            long ms = RecorderService.stop();
            JSObject r = new JSObject();
            r.put("path", p);
            r.put("size", new File(p).length());
            r.put("durationMs", ms);
            call.resolve(r);
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("state", RecorderService.state);
        r.put("elapsedMs", RecorderService.elapsed());
        r.put("level", RecorderService.level());
        r.put("path", RecorderService.path);
        call.resolve(r);
    }

    /** 보낸 녹음 지우기 (앱의 녹음 폴더 안 파일만) */
    @PluginMethod
    public void remove(PluginCall call) {
        try {
            File f = new File(call.getString("path", "")).getCanonicalFile();
            if (!f.getPath().startsWith(recDir().getCanonicalPath() + File.separator)) { call.reject("지울 수 없는 파일"); return; }
            f.delete();
            call.resolve();
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    // ---------- PC로 보내기: 녹음 파일을 PUT으로 흘려 보낸다 (큰 파일도 메모리에 다 올리지 않고) ----------

    @PluginMethod
    public void upload(PluginCall call) {
        String url = call.getString("url"), token = call.getString("token"), path = call.getString("path"), ext = call.getString("ext", "m4a");
        work.execute(() -> {
            HttpURLConnection c = null;
            try {
                File f = new File(path);
                if (!f.exists()) { call.reject("녹음 파일이 휴대폰에 없습니다"); return; }
                long total = f.length();
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestMethod("PUT");
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(total);
                c.setConnectTimeout(8000);
                c.setReadTimeout(5 * 60 * 1000);
                c.setRequestProperty("Authorization", "Bearer " + token);
                c.setRequestProperty("X-Ext", ext);
                c.setRequestProperty("Content-Type", "application/octet-stream");
                byte[] buf = new byte[64 * 1024];
                long sent = 0;
                int lastPct = -1;
                try (InputStream in = new FileInputStream(f); OutputStream out = c.getOutputStream()) {
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        sent += n;
                        int pct = (int) (sent * 100 / Math.max(1, total));
                        if (pct != lastPct) {
                            lastPct = pct;
                            JSObject ev = new JSObject();
                            ev.put("path", path);
                            ev.put("percent", pct);
                            notifyListeners("uploadProgress", ev);
                        }
                    }
                }
                int code = c.getResponseCode();
                JSObject r = new JSObject();
                r.put("status", code);
                r.put("body", readAll(code >= 400 ? c.getErrorStream() : c.getInputStream()));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("PC로 보내지 못했습니다: " + e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    private static String readAll(InputStream in) throws Exception {
        if (in == null) return "";
        try (InputStream s = in) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = s.read(buf)) > 0) b.write(buf, 0, n);
            return b.toString("UTF-8");
        }
    }

    // ---------- 같은 Wi-Fi의 PC 찾기: 알림 신호(브로드캐스트)를 보내고 대답한 PC를 모은다 ----------

    @PluginMethod
    public void discover(PluginCall call) {
        int timeout = call.getInt("timeoutMs", 2000);
        work.execute(() -> {
            Map<String, JSObject> found = new LinkedHashMap<>();
            try (DatagramSocket s = new DatagramSocket()) {
                s.setBroadcast(true);
                s.setSoTimeout(250);
                byte[] q = "MEETINGNOTES?".getBytes(StandardCharsets.UTF_8);
                long end = System.currentTimeMillis() + timeout;
                long nextSend = 0;
                byte[] buf = new byte[2048];
                while (System.currentTimeMillis() < end) {
                    if (System.currentTimeMillis() >= nextSend) {            // 잃어버릴 수 있어 몇 번 보낸다
                        for (InetAddress a : targets()) {
                            try { s.send(new DatagramPacket(q, q.length, a, DISCOVERY_PORT)); } catch (Exception ignored) { }
                        }
                        nextSend = System.currentTimeMillis() + 700;
                    }
                    try {
                        DatagramPacket p = new DatagramPacket(buf, buf.length);
                        s.receive(p);
                        JSONObject j = new JSONObject(new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8));
                        if (!"MeetingNotes".equals(j.optString("app"))) continue;
                        String host = p.getAddress().getHostAddress();
                        int port = j.optInt("port", 47213);
                        JSObject o = new JSObject();
                        o.put("host", host);
                        o.put("port", port);
                        o.put("name", j.optString("name", host));
                        o.put("version", j.optString("version", ""));
                        found.put(host + ":" + port, o);
                    } catch (SocketTimeoutException ignored) { }
                }
            } catch (Exception e) {
                call.reject("PC를 찾지 못했습니다: " + e.getMessage());
                return;
            }
            JSArray arr = new JSArray();
            for (JSObject o : found.values()) arr.put(o);
            JSObject r = new JSObject();
            r.put("found", arr);
            call.resolve(r);
        });
    }

    private InetAddress[] targets() {
        java.util.List<InetAddress> out = new java.util.ArrayList<>();
        try { out.add(InetAddress.getByName("255.255.255.255")); } catch (Exception ignored) { }
        try {
            WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            DhcpInfo d = wm.getDhcpInfo();
            if (d != null && d.ipAddress != 0) {
                int bc = (d.ipAddress & d.netmask) | ~d.netmask;
                byte[] b = { (byte) bc, (byte) (bc >> 8), (byte) (bc >> 16), (byte) (bc >> 24) };
                out.add(InetAddress.getByAddress(b));
            }
        } catch (Exception ignored) { }
        // 에뮬레이터에서는 이 PC가 10.0.2.2
        if (Build.FINGERPRINT.contains("generic") || Build.PRODUCT.contains("sdk")) {
            try { out.add(InetAddress.getByName("10.0.2.2")); } catch (Exception ignored) { }
        }
        return out.toArray(new InetAddress[0]);
    }

    // ---------- 공유 ----------

    @PluginMethod
    public void shareText(PluginCall call) {
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, call.getString("text", ""))
            .putExtra(Intent.EXTRA_SUBJECT, call.getString("subject", ""));
        getActivity().startActivity(Intent.createChooser(send, "회의록 공유"));
        call.resolve();
    }

    /** PC에서 워드·PDF를 받아 공유 창을 연다 */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String url = call.getString("url"), token = call.getString("token"), mime = call.getString("mime", "application/octet-stream");
        work.execute(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(90000);
                c.setRequestProperty("Authorization", "Bearer " + token);
                int code = c.getResponseCode();
                if (code != 200) {
                    String body = readAll(c.getErrorStream());
                    String msg = "PC 오류 " + code;
                    try { msg = new JSONObject(body).optString("error", msg); } catch (Exception ignored) { }
                    call.reject(msg);
                    return;
                }
                String name = "회의록";
                Matcher m = Pattern.compile("filename\\*=UTF-8''([^;]+)").matcher(String.valueOf(c.getHeaderField("Content-Disposition")));
                if (m.find()) name = URLDecoder.decode(m.group(1), "UTF-8");
                name = name.replaceAll("[\\\\/:*?\"<>|]", " ");
                File dir = new File(getContext().getCacheDir(), "share");
                dir.mkdirs();
                File[] old = dir.listFiles();
                if (old != null) for (File o : old) o.delete();
                File out = new File(dir, name);
                try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out);
                Intent send = new Intent(Intent.ACTION_SEND).setType(mime)
                    .putExtra(Intent.EXTRA_STREAM, uri)
                    .putExtra(Intent.EXTRA_SUBJECT, name)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                send.setClipData(ClipData.newRawUri(name, uri));
                Intent chooser = Intent.createChooser(send, "회의록 공유");
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().runOnUiThread(() -> getActivity().startActivity(chooser));
                call.resolve();
            } catch (Exception e) {
                call.reject("파일을 받지 못했습니다: " + e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("https://")) { call.reject("열 수 없는 주소"); return; }
        getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        call.resolve();
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            r.put("version", pi.versionName);
        } catch (Exception e) { r.put("version", "0.0.0"); }
        String name = null;
        try { name = Settings.Global.getString(getContext().getContentResolver(), Settings.Global.DEVICE_NAME); } catch (Exception ignored) { }
        r.put("device", name != null && !name.isEmpty() ? name : Build.MODEL);
        call.resolve(r);
    }
}
