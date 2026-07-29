"""
ota_updater - Custom ESPHome component สำหรับอัปเดตเฟิร์มแวร์ ESP32 จากไฟล์
.bin ที่ถูก push ขึ้น GitHub (อ่านผ่าน raw.githubusercontent.com) โดยเช็ค
เวอร์ชันล่าสุดจาก Firebase Realtime Database เป็นระยะ

การทำงานคร่าวๆ (รายละเอียดจริงอยู่ใน ota_updater.cpp):
1. ทุกๆ update_interval (ค่าเริ่มต้น 60s) จะยิง HTTPS GET ไปที่ firebase_url
   เพื่ออ่าน {latest_version, url, update_flag}
2. ถ้า latest_version != current_version (เวอร์ชันที่คอมไพล์ตอนนี้) และ
   update_flag เป็น true -> เริ่มดาวน์โหลดไฟล์ .bin จาก url แล้วเขียนทับ
   partition ที่ไม่ได้ใช้งานอยู่ (OTA partition safety - ดูคอมเมนต์ .cpp)
3. ถ้าเขียนสำเร็จ -> รีสตาร์ทเข้าเฟิร์มแวร์ใหม่ทันที
4. ถ้าล้มเหลว -> ไม่แตะ partition ที่ใช้งานอยู่ บอร์ดยังคงบูตด้วยเฟิร์มแวร์เดิม
"""

import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.const import CONF_ID

CODEOWNERS = ["@user"]
DEPENDENCIES = ["wifi", "network"]
AUTO_LOAD = ["json"]

ota_updater_ns = cg.esphome_ns.namespace("ota_updater")
OtaUpdater = ota_updater_ns.class_("OtaUpdater", cg.PollingComponent)

CONF_FIREBASE_URL = "firebase_url"
CONF_CURRENT_VERSION = "current_version"
CONF_MAX_RETRIES = "max_retries"
CONF_INSECURE_TLS = "insecure_tls"

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(OtaUpdater),
        # ต้องชี้ไปที่ไฟล์ .json บน Firebase ที่มี latest_version/url/update_flag
        # เช่น https://xxx.firebasedatabase.app/JK_BMS_HUB/.../firmware.json
        cv.Required(CONF_FIREBASE_URL): cv.string,
        # เวอร์ชันปัจจุบันของเฟิร์มแวร์นี้ - ควรผูกกับ substitution เดียวกับที่
        # ใช้ตั้งชื่อไฟล์ .bin ตอน build/push ขึ้น GitHub เพื่อไม่ให้หลุดกัน
        cv.Required(CONF_CURRENT_VERSION): cv.string,
        # จำนวนครั้งสูงสุดที่จะลองอัปเดต "เวอร์ชันเดียวกัน" ซ้ำถ้าล้มเหลว
        # ก่อนจะเลิกลอง (กันลูปดาวน์โหลดไม่รู้จบถ้าไฟล์บน GitHub เสียถาวร)
        cv.Optional(CONF_MAX_RETRIES, default=3): cv.positive_int,
        # true = ข้ามการตรวจ TLS certificate ตอนดาวน์โหลด (ไม่แนะนำ ใช้ชั่วคราว
        # เวลา debug เท่านั้น) - ค่าเริ่มต้น false ใช้ root CA จริงที่ฝังไว้ใน .cpp
        cv.Optional(CONF_INSECURE_TLS, default=False): cv.boolean,
    }
).extend(cv.polling_component_schema("60s"))


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    cg.add(var.set_firebase_url(config[CONF_FIREBASE_URL]))
    cg.add(var.set_current_version(config[CONF_CURRENT_VERSION]))
    cg.add(var.set_max_retries(config[CONF_MAX_RETRIES]))
    cg.add(var.set_insecure_tls(config[CONF_INSECURE_TLS]))
    # HTTPClient / WiFiClientSecure / Update ship with the ESP32 Arduino core
    # itself (esp32: framework: type: arduino) - no extra lib_deps needed.
