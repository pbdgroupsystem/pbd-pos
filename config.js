// ตั้งค่าหน้าขาย PBD POS — แก้ 2 บรรทัดนี้หลังสร้าง deployment และ LIFF
window.POS_CONFIG = {
  // URL /exec ของ deployment ใหม่ใน PBDSTOCK (Execute as: Me, Who has access: Anyone)
  API_URL: 'https://script.google.com/macros/s/PUT_DEPLOYMENT_ID_HERE/exec',
  // LIFF ID ที่ Endpoint URL ชี้มาที่หน้านี้บน GitHub Pages (scope: openid, profile)
  LIFF_ID: 'PUT_LIFF_ID_HERE',
  APP_VERSION: '1.4.0'
};
