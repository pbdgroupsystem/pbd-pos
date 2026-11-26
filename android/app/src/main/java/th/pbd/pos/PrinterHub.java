package th.pbd.pos;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.os.RemoteException;
import android.util.Log;

import com.sunmi.peripheral.printer.InnerPrinterCallback;
import com.sunmi.peripheral.printer.InnerPrinterManager;
import com.sunmi.peripheral.printer.SunmiPrinterService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;

/**
 * ส่ง ESC/POS ไปเครื่องพิมพ์
 *  - "sunmi"        : เครื่องพิมพ์ในตัว SUNMI ผ่าน Sunmi Printer SDK (sendRAWData)
 *  - "bt:AA:BB:..." : เครื่องพิมพ์ Bluetooth แบบ SPP ที่จับคู่ไว้ในตั้งค่า Android แล้ว (เช่น MP210 / PT-210)
 */
final class PrinterHub {
    private static final String TAG = "PBDPOS";
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private final Context ctx;
    private volatile SunmiPrinterService sunmi;
    private volatile boolean sunmiTried;
    private InnerPrinterCallback sunmiCb;
    private BluetoothSocket sock;
    private String sockAddr;

    PrinterHub(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        bindSunmi();
    }

    /* ---------- SUNMI ---------- */
    private void bindSunmi() {
        try {
            sunmiCb = new InnerPrinterCallback() {
                @Override public void onConnected(SunmiPrinterService service) { sunmi = service; }
                @Override public void onDisconnected() { sunmi = null; }
            };
            sunmiTried = InnerPrinterManager.getInstance().bindService(ctx, sunmiCb);
        } catch (Throwable t) {
            sunmiTried = false;
            Log.w(TAG, "no sunmi service", t);
        }
    }

    boolean hasSunmi() { return sunmi != null; }

    void release() {
        closeSock();
        if (sunmiTried && sunmiCb != null) {
            try { InnerPrinterManager.getInstance().unBindService(ctx, sunmiCb); } catch (Throwable ignored) { }
        }
    }

    /* ---------- รายการเครื่องพิมพ์ ---------- */
    JSONArray list(boolean btAllowed) {
        JSONArray a = new JSONArray();
        try {
            if (sunmi != null) a.put(new JSONObject().put("id", "sunmi").put("name", "เครื่องพิมพ์ในตัว SUNMI").put("kind", "sunmi"));
            BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
            if (btAllowed && ad != null && ad.isEnabled()) {
                Set<BluetoothDevice> bonded = ad.getBondedDevices();
                if (bonded != null) for (BluetoothDevice d : bonded) {
                    String n = d.getName() == null ? d.getAddress() : d.getName();
                    // InnerPrinter = เครื่องพิมพ์เสมือนของ SUNMI (ใช้ทาง SDK แทนได้ แต่ให้เลือกได้ด้วย)
                    a.put(new JSONObject().put("id", "bt:" + d.getAddress()).put("name", n).put("kind", "bt"));
                }
            }
        } catch (Exception e) { Log.w(TAG, "list", e); }
        return a;
    }

    /* ---------- พิมพ์ ---------- */
    synchronized void print(String target, byte[] data, boolean slow) throws Exception {
        if ("sunmi".equals(target)) { printSunmi(data); return; }
        if (target != null && target.startsWith("bt:")) { printBt(target.substring(3), data, slow); return; }
        throw new Exception("ยังไม่ได้เลือกเครื่องพิมพ์");
    }

    private void printSunmi(byte[] data) throws Exception {
        SunmiPrinterService s = sunmi;
        if (s == null) {
            if (!sunmiTried) bindSunmi();
            for (int i = 0; i < 20 && sunmi == null; i++) Thread.sleep(150);
            s = sunmi;
        }
        if (s == null) throw new Exception("เชื่อมต่อเครื่องพิมพ์ในตัว SUNMI ไม่ได้");
        try {
            int st = s.updatePrinterState();
            if (st == 4) throw new Exception("เครื่องพิมพ์ SUNMI กระดาษหมด");
            if (st == 3) throw new Exception("เครื่องพิมพ์ SUNMI ไม่พร้อม (ฝาเปิด/สื่อสารผิดพลาด)");
        } catch (RemoteException ignored) { }
        final int n = 4096;
        for (int i = 0; i < data.length; i += n) {
            int len = Math.min(n, data.length - i);
            byte[] part = new byte[len];
            System.arraycopy(data, i, part, 0, len);
            s.sendRAWData(part, null);
        }
    }

    private void closeSock() {
        if (sock != null) { try { sock.close(); } catch (IOException ignored) { } }
        sock = null; sockAddr = null;
    }

    private BluetoothSocket open(String addr) throws Exception {
        if (sock != null && addr.equals(sockAddr) && sock.isConnected()) return sock;
        closeSock();
        BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
        if (ad == null) throw new Exception("เครื่องนี้ไม่มี Bluetooth");
        if (!ad.isEnabled()) throw new Exception("กรุณาเปิด Bluetooth");
        BluetoothDevice d = ad.getRemoteDevice(addr);
        try { ad.cancelDiscovery(); } catch (SecurityException ignored) { }
        Exception last = null;
        for (int t = 0; t < 3; t++) {
            BluetoothSocket s = null;
            try {
                s = t < 2 ? d.createRfcommSocketToServiceRecord(SPP) : d.createInsecureRfcommSocketToServiceRecord(SPP);
                s.connect();
                sock = s; sockAddr = addr;
                return s;
            } catch (Exception e) {
                last = e;
                if (s != null) { try { s.close(); } catch (IOException ignored) { } }
                Thread.sleep(600);
            }
        }
        throw new Exception("ต่อเครื่องพิมพ์ " + (d.getName() == null ? addr : d.getName()) + " ไม่ได้ — เปิดเครื่องพิมพ์ให้อยู่ใกล้ แล้วลองใหม่"
            + (last != null && last.getMessage() != null ? " (" + last.getMessage() + ")" : ""));
    }

    private void printBt(String addr, byte[] data, boolean slow) throws Exception {
        for (int attempt = 0; attempt < 2; attempt++) {
            int sent = 0;
            try {
                OutputStream out = open(addr).getOutputStream();
                final int n = slow ? 256 : 1024;
                for (int i = 0; i < data.length; i += n) {
                    out.write(data, i, Math.min(n, data.length - i));
                    out.flush();
                    sent += n;
                    Thread.sleep(slow ? 25 : 8);   // เว้นจังหวะให้เครื่องพิมพ์พกพาบัฟเฟอร์เล็กทัน
                }
                return;
            } catch (IOException e) {
                closeSock();
                // การเชื่อมต่อเก่าหมดอายุ (ยังไม่ได้ส่งอะไร) → ต่อใหม่แล้วส่งอีกครั้ง · ถ้าหลุดกลางใบ ไม่ส่งซ้ำเอง (กันพิมพ์ซ้อน)
                if (attempt == 1 || sent > 0) throw new Exception("ส่งข้อมูลไปเครื่องพิมพ์ไม่สำเร็จ" + (sent > 0 ? " (หลุดกลางใบ — ตรวจใบที่ออกก่อนพิมพ์ซ้ำ)" : "") + ": " + e.getMessage());
            }
        }
    }
}
