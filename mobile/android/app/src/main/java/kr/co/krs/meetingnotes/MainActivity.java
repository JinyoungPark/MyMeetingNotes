package kr.co.krs.meetingnotes;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RecPlugin.class);        // 녹음·보내기·찾기·공유 (RecPlugin.java)
        super.onCreate(savedInstanceState);
    }
}
