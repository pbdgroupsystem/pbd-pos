# PBD POS (Android)

แอป Android ที่เปิดเว็บแอป PBD POS (https://pbdgroupsystem.github.io/pbd-pos/) เต็มจอ
และเพิ่มการพิมพ์ใบเสร็จแบบ native ผ่าน `window.PBDNative`:

- เครื่องพิมพ์ในตัว SUNMI ผ่าน Sunmi Printer SDK (`sendRAWData`)
- เครื่องพิมพ์ Bluetooth แบบ SPP ที่จับคู่ใน Android แล้ว (เช่น MP210 / PT-210)
- จำเครื่องพิมพ์ไว้ถาวร · พิมพ์อัตโนมัติ / รับงานพิมพ์จาก iPhone ได้
- แชร์รูปใบเสร็จ · กล้องสำหรับสแกนบัตรประชาชน

หน้าจอและข้อมูลมาจากเว็บแอปเดิม แก้เว็บแล้วแอปได้ของใหม่ทันที ไม่ต้องออก APK ใหม่

## สร้าง APK
GitHub Actions (`.github/workflows/android.yml`) สร้างให้อัตโนมัติเมื่อมีการแก้ไฟล์ในโฟลเดอร์ `android/`
แล้วปล่อยไฟล์ `pbd-pos.apk` ที่หน้า Releases ของ repo

ลิงก์ดาวน์โหลดรุ่นล่าสุด: https://github.com/pbdgroupsystem/pbd-pos/releases/latest/download/pbd-pos.apk

กุญแจเซ็นแอปอยู่ใน GitHub Secret `PBD_KEYSTORE_B64` (ไฟล์ .jks แบบ base64) — ต้องใช้กุญแจเดิมทุกครั้ง
เพื่อให้ติดตั้งรุ่นใหม่ทับรุ่นเก่าได้ ห้ามใส่ไฟล์กุญแจลง repo
