#pragma once

#include "esphome/core/component.h"
#include "esphome/core/preferences.h"

#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Update.h>
#include <string>

namespace esphome {
namespace ota_updater {

// เก็บสถานะการลองอัปเดตล่าสุดไว้ใน NVS (flash แบบ persist ข้ามการรีบูต)
// เพื่อจำกัดจำนวนครั้งที่จะลองซ้ำ "เวอร์ชันเดียวกัน" ถ้ามันล้มเหลวต่อเนื่อง -
// เก็บแยกต่อเวอร์ชัน (last_attempted_version) เพื่อให้เวอร์ชันใหม่ที่เพิ่ง
// ประกาศมา ได้โควตาลองใหม่เต็มจำนวนเสมอ ไม่ถูกบล็อกค้างจากเวอร์ชันเก่าที่เคย
// ลองแล้วล้มเหลวจนหมดโควตา
struct OtaRetryState {
  char last_attempted_version[32];
  uint8_t failed_attempts;
};

class OtaUpdater : public PollingComponent {
 public:
  void setup() override;
  void update() override;
  void dump_config() override;

  void set_firebase_url(const std::string &url) { firebase_url_ = url; }
  void set_current_version(const std::string &version) { current_version_ = version; }
  void set_max_retries(uint8_t retries) { max_retries_ = retries; }
  void set_insecure_tls(bool insecure) { insecure_tls_ = insecure; }

 protected:
  // ดึง {latest_version, url, update_flag} จาก Firebase - คืน false ถ้า
  // network/parse ล้มเหลว (ไม่ถือเป็น "ลองอัปเดตแล้วล้มเหลว" จึงไม่นับ retry)
  bool fetch_firmware_info_(std::string &out_version, std::string &out_url, bool &out_flag);

  // ดาวน์โหลดไฟล์ .bin จาก url แล้วเขียนลง OTA partition ที่ไม่ได้ใช้งาน
  // คืน true เมื่อเขียนสำเร็จและพร้อมรีสตาร์ท
  bool perform_update_(const std::string &url, const std::string &version);

  // เขียน update_flag=false กลับไปที่ Firebase (กันไม่ให้ลองอัปเดตซ้ำเวอร์ชัน
  // เดิมทุกรอบ poll หลังอัปเดตสำเร็จ/หรือแอดมินสั่งยกเลิก)
  void clear_update_flag_();

  OtaRetryState load_retry_state_();
  void save_retry_state_(const OtaRetryState &state);

  std::string firebase_url_;
  std::string current_version_;
  uint8_t max_retries_{3};
  bool insecure_tls_{false};

  // กันไม่ให้ update() ที่สอง (ยิง poll ใหม่ตาม update_interval) เข้ามาซ้อน
  // ระหว่างที่กำลังดาวน์โหลด/เขียน partition อยู่จากรอบก่อนหน้า
  bool update_in_progress_{false};

  ESPPreferenceObject pref_;
};

}  // namespace ota_updater
}  // namespace esphome
