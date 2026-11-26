package th.pbd.pos;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * PBD POS สำหรับ Android: เปิดเว็บแอป PBD POS ตัวเดิมเต็มจอ + สะพานพิมพ์ใบเสร็จแบบ native
 * หน้าเว็บเรียกผ่าน window.PBDNative (ดู app.js: โหมดพิมพ์ "app")
 */
public class MainActivity extends Activity {
    static final String HOME = "https://pbdgroupsystem.github.io/pbd-pos/";
    private static final int REQ_BT = 11, REQ_CAM = 12, REQ_FILE = 13;

    private WebView web;
    private PrinterHub printers;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private ValueCallback<Uri[]> fileCb;
    private PermissionRequest pendingCam;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#121012"));
        w.setNavigationBarColor(Color.parseColor("#121012"));
        printers = new PrinterHub(this);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#121012"));
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " PBDPOS-Android/" + version());
        web.addJavascriptInterface(new Bridge(), "PBDNative");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (b != null) web.restoreState(b);
        else web.loadUrl(startUrl(getIntent()));
    }

    private String startUrl(Intent it) {
        Uri u = it == null ? null : it.getData();
        if (u != null && "https".equals(u.getScheme()) && "pbdgroupsystem.github.io".equals(u.getHost())) return u.toString();
        return HOME;
    }

    @Override
    protected void onNewIntent(Intent it) {
        super.onNewIntent(it);
        if (it != null && it.getData() != null) web.loadUrl(startUrl(it));   // กลับมาจาก LINE Login
    }

    @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); web.saveState(o); }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        printers.release();
        io.shutdown();
        super.onDestroy();
    }

    private String version() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "1"; }
    }

    private boolean btAllowed() {
        return Build.VERSION.SDK_INT < 31 || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    private void js(final String code) { main.post(() -> web.evaluateJavascript(code, null)); }

    private static String q(String s) { return JSONObject.quote(s == null ? "" : s); }

    /* ---------- หน้าเว็บ ---------- */
    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            String sc = u.getScheme() == null ? "" : u.getScheme();
            if (sc.equals("http") || sc.equals("https")) return false;   // เว็บทั้งหมด (รวมหน้า LINE Login) เปิดในแอป
            try {   // line:// intent:// ฯลฯ → ส่งให้แอปที่เกี่ยวข้อง
                Intent it = sc.equals("intent") ? Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, u);
                it.addCategory(Intent.CATEGORY_BROWSABLE);
                it.setComponent(null);
                startActivity(it);
            } catch (Exception e) {
                try {
                    Intent it = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME);
                    String fb = it.getStringExtra("browser_fallback_url");
                    if (fb != null) v.loadUrl(fb);
                } catch (Exception ignored) { }
            }
            return true;
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(final PermissionRequest req) {
            main.post(() -> {
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    req.grant(req.getResources());
                } else {
                    pendingCam = req;
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAM);
                }
            });
        }

        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (fileCb != null) fileCb.onReceiveValue(null);
            fileCb = cb;
            try {
                startActivityForResult(p.createIntent(), REQ_FILE);
            } catch (ActivityNotFoundException e) {
                fileCb = null;
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int code, int res, Intent data) {
        if (code == REQ_FILE && fileCb != null) {
            Uri[] out = null;
            if (res == RESULT_OK && data != null) {
                ClipData cd = data.getClipData();
                if (cd != null) {
                    out = new Uri[cd.getItemCount()];
                    for (int i = 0; i < cd.getItemCount(); i++) out[i] = cd.getItemAt(i).getUri();
                } else if (data.getData() != null) out = new Uri[]{data.getData()};
            }
            fileCb.onReceiveValue(out);
            fileCb = null;
            return;
        }
        super.onActivityResult(code, res, data);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        boolean ok = res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED;
        if (code == REQ_CAM && pendingCam != null) {
            if (ok) pendingCam.grant(pendingCam.getResources()); else pendingCam.deny();
            pendingCam = null;
        } else if (code == REQ_BT) {
            js("window.PBDNativeEvent&&PBDNativeEvent('bt'," + ok + ")");
        }
    }

    /* ---------- สะพานให้หน้าเว็บเรียก ---------- */
    private final class Bridge {
        @JavascriptInterface
        public String info() {
            try {
                return new JSONObject().put("app", "pbd-pos-android").put("version", version())
                    .put("sunmi", printers.hasSunmi()).put("bt", btAllowed()).put("model", Build.MANUFACTURER + " " + Build.MODEL).toString();
            } catch (Exception e) { return "{}"; }
        }

        /** รายการเครื่องพิมพ์: เครื่องพิมพ์ในตัว SUNMI + เครื่อง Bluetooth ที่จับคู่ไว้ */
        @JavascriptInterface
        public String printers() { return printers.list(btAllowed()).toString(); }

        /** ขอสิทธิ์ Bluetooth (Android 12+) — ผลส่งกลับทาง PBDNativeEvent('bt', ok) */
        @JavascriptInterface
        public void requestBluetooth() {
            main.post(() -> {
                if (btAllowed()) js("window.PBDNativeEvent&&PBDNativeEvent('bt',true)");
                else requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, REQ_BT);
            });
        }

        @JavascriptInterface
        public void openBluetoothSettings() {
            main.post(() -> {
                try { startActivity(new Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS)); } catch (Exception ignored) { }
            });
        }

        /** พิมพ์ ESC/POS (base64) — ผลส่งกลับทาง PBDNativeCb(id, ok, message) */
        @JavascriptInterface
        public void print(final String id, final String target, final String b64, final boolean slow) {
            io.execute(() -> {
                String msg = "";
                boolean ok = false;
                try {
                    printers.print(target, Base64.decode(b64, Base64.DEFAULT), slow);
                    ok = true;
                } catch (Throwable e) {
                    msg = e.getMessage() == null ? e.toString() : e.getMessage();
                }
                js("window.PBDNativeCb&&PBDNativeCb(" + q(id) + "," + ok + "," + q(msg) + ")");
            });
        }

        /** แชร์รูปใบเสร็จ (data:image/png;base64,...) ไปแอปอื่น */
        @JavascriptInterface
        public void shareImage(final String dataUrl, final String name) {
            io.execute(() -> {
                try {
                    String b = dataUrl.substring(dataUrl.indexOf(',') + 1);
                    File dir = new File(getCacheDir(), "share");
                    if (!dir.exists()) dir.mkdirs();
                    String fn = (name == null || name.isEmpty() ? "receipt.png" : name).replaceAll("[^A-Za-z0-9._-]", "_");
                    File f = new File(dir, fn);
                    try (FileOutputStream o = new FileOutputStream(f)) { o.write(Base64.decode(b, Base64.DEFAULT)); }
                    Uri u = Uri.parse("content://" + ShareProvider.AUTH + "/" + fn);
                    Intent it = new Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM, u)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    main.post(() -> startActivity(Intent.createChooser(it, "แชร์ใบเสร็จ")));
                } catch (Exception e) {
                    main.post(() -> Toast.makeText(MainActivity.this, "แชร์ไม่ได้: " + e.getMessage(), Toast.LENGTH_LONG).show());
                }
            });
        }
    }
}
