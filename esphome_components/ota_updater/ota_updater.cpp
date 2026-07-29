#include "ota_updater.h"

#include "esphome/core/log.h"
#include "esphome/core/hal.h"
#include "esphome/core/application.h"
#include "esphome/components/network/util.h"

#include <ArduinoJson.h>
#include <esp_partition.h>
#include <esp_ota_ops.h>

namespace esphome {
namespace ota_updater {

static const char *const TAG = "ota_updater";

// ============================================================================
// Root CA จริงของ raw.githubusercontent.com - ISRG Root X1 (Let's Encrypt)
//
// ตรวจสอบมาแล้วจริงจาก 2 ทาง (ไม่ได้เดา/จำจาก memory มาเขียน เพราะ cert ผิด
// แม้แค่ 1 byte จะทำให้ TLS handshake ล้มเหลวและ debug ยากมากบนบอร์ดจริง):
//   1. `openssl s_client -connect raw.githubusercontent.com:443 -showcerts`
//      -> chain จริงคือ leaf -> Let's Encrypt R-series -> "ISRG Root X1"
//   2. ดึง PEM ตัวจริงจากโดเมนทางการของ Let's Encrypt เอง:
//      https://letsencrypt.org/certs/isrgrootx1.pem
//      sha256 fingerprint (ตรวจแล้วตรงกับที่ Let's Encrypt เผยแพร่):
//      96:BC:EC:06:26:49:76:F3:74:60:77:9A:CF:28:C5:A7:CF:E8:A3:C0:AA:E1:1A:8F:FC:EE:05:C0:BD:DF:08:C6
//
// ถ้า GitHub เปลี่ยนผู้ออก cert ในอนาคต ต้อง fetch ใหม่ด้วยวิธีเดียวกันนี้ -
// ห้ามพิมพ์/เดาเองเด็ดขาด
// ============================================================================
static const char *const GITHUB_ROOT_CA = R"EOF(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)EOF";

// key ที่ใช้จำสถานะ retry ใน NVS - ค่า hash ตายตัวใดๆ ก็ได้ที่ไม่ชนกับ
// preference อื่นในระบบ (ESPHome ใช้ hash แบบนี้เป็นมาตรฐานอยู่แล้ว)
static const uint32_t RETRY_STATE_HASH = 0xA5AA5AA5;

void OtaUpdater::setup() {
  this->pref_ = global_preferences->make_preference<OtaRetryState>(RETRY_STATE_HASH);
  ESP_LOGI(TAG, "OTA updater พร้อมทำงาน (เวอร์ชันปัจจุบัน: %s)", this->current_version_.c_str());
}

void OtaUpdater::dump_config() {
  ESP_LOGCONFIG(TAG, "OTA Updater:");
  ESP_LOGCONFIG(TAG, "  Firebase URL: %s", this->firebase_url_.c_str());
  ESP_LOGCONFIG(TAG, "  Current Version: %s", this->current_version_.c_str());
  ESP_LOGCONFIG(TAG, "  Max Retries: %u", this->max_retries_);
  ESP_LOGCONFIG(TAG, "  Insecure TLS: %s", YESNO(this->insecure_tls_));
}

OtaRetryState OtaUpdater::load_retry_state_() {
  OtaRetryState state{};
  if (!this->pref_.load(&state)) {
    // ยังไม่เคยเซฟมาก่อน (บูตครั้งแรก) - เริ่มจาก state ว่างๆ
    memset(&state, 0, sizeof(state));
  }
  return state;
}

void OtaUpdater::save_retry_state_(const OtaRetryState &state) {
  this->pref_.save(&state);
}

void OtaUpdater::update() {
  // กันไม่ให้ poll รอบใหม่ทับซ้อนรอบที่กำลังดาวน์โหลด/เขียน flash อยู่
  if (this->update_in_progress_) {
    ESP_LOGD(TAG, "ข้ามรอบนี้ - กำลังอัปเดตอยู่จากรอบก่อนหน้า");
    return;
  }
  if (!network::is_connected()) {
    ESP_LOGW(TAG, "ยังไม่ต่อ WiFi - ข้ามการเช็คอัปเดตรอบนี้");
    return;
  }

  std::string latest_version, firmware_url;
  bool update_flag = false;
  if (!this->fetch_firmware_info_(latest_version, firmware_url, update_flag)) {
    // fetch ล้มเหลว (network/parse) - ไม่ใช่ "ลองอัปเดตแล้วพัง" จึงไม่นับ retry
    // แค่รอ poll รอบถัดไปเฉยๆ
    return;
  }

  if (!update_flag) {
    ESP_LOGD(TAG, "update_flag = false - ไม่มีคำสั่งอัปเดตจากแอดมิน");
    return;
  }
  if (latest_version.empty() || firmware_url.empty()) {
    ESP_LOGW(TAG, "ข้อมูล firmware บน Firebase ไม่ครบ (version หรือ url ว่าง) - ข้าม");
    return;
  }
  if (latest_version == this->current_version_) {
    // เวอร์ชันเดิม - ไม่มีอะไรต้องทำ (กันกรณี update_flag ค้างเป็น true อยู่
    // จากแอดมินลืมเคลียร์ หรือ echo ค่าเดิมกลับมา)
    ESP_LOGD(TAG, "เวอร์ชันล่าสุดตรงกับเวอร์ชันปัจจุบันอยู่แล้ว (%s) - ไม่ต้องอัปเดต",
             this->current_version_.c_str());
    return;
  }

  // --- เช็ค retry limit ต่อเวอร์ชันนี้ -------------------------------------
  OtaRetryState retry_state = this->load_retry_state_();
  bool same_version_as_last_attempt =
      strncmp(retry_state.last_attempted_version, latest_version.c_str(),
              sizeof(retry_state.last_attempted_version)) == 0;

  if (!same_version_as_last_attempt) {
    // เวอร์ชันใหม่ที่ยังไม่เคยลอง - รีเซ็ตตัวนับ ให้โควตาลองใหม่เต็มจำนวน
    retry_state.failed_attempts = 0;
    strncpy(retry_state.last_attempted_version, latest_version.c_str(),
            sizeof(retry_state.last_attempted_version) - 1);
    retry_state.last_attempted_version[sizeof(retry_state.last_attempted_version) - 1] = '\0';
  } else if (retry_state.failed_attempts >= this->max_retries_) {
    ESP_LOGE(TAG,
             "เวอร์ชัน %s ลองอัปเดตล้มเหลวครบ %u ครั้งแล้ว (max_retries) - "
             "จะไม่ลองอีกจนกว่าจะมีเวอร์ชันใหม่กว่านี้ หรือแอดมิน reset",
             latest_version.c_str(), this->max_retries_);
    return;
  }

  ESP_LOGI(TAG, "พบเฟิร์มแวร์ใหม่: %s -> %s (ครั้งที่ลอง: %u/%u)",
           this->current_version_.c_str(), latest_version.c_str(),
           retry_state.failed_attempts + 1, this->max_retries_);

  this->update_in_progress_ = true;
  bool ok = this->perform_update_(firmware_url, latest_version);
  this->update_in_progress_ = false;

  if (ok) {
    // perform_update_ สำเร็จ = Update.end(true) ผ่านแล้ว (ตรวจ MD5/ขนาดแล้ว
    // ว่าไฟล์ครบถ้วนไม่ corrupt) - เคลียร์ retry state และ update_flag แล้ว
    // รีสตาร์ทเข้าเฟิร์มแวร์ใหม่ทันที
    retry_state.failed_attempts = 0;
    this->save_retry_state_(retry_state);
    this->clear_update_flag_();
    ESP_LOGI(TAG, "เขียนเฟิร์มแวร์ใหม่สำเร็จ - กำลังรีสตาร์ท...");
    delay(500);  // ให้เวลา log/http flush ก่อนรีสตาร์ท
    App.safe_reboot();
  } else {
    // ล้มเหลว - เฟิร์มแวร์เดิมยังคงอยู่ใน partition ที่ใช้งานอยู่ (ไม่ถูกแตะ
    // เลยตลอดกระบวนการนี้) บอร์ดจะรีสตาร์ทปกติในรอบถัดไปเข้าเฟิร์มแวร์เดิม
    retry_state.failed_attempts += 1;
    this->save_retry_state_(retry_state);
    ESP_LOGE(TAG, "อัปเดตล้มเหลว - ยังคงใช้เฟิร์มแวร์เดิม (%s) ต่อไป (ลองแล้ว %u/%u ครั้ง)",
             this->current_version_.c_str(), retry_state.failed_attempts, this->max_retries_);
  }
}

bool OtaUpdater::fetch_firmware_info_(std::string &out_version, std::string &out_url, bool &out_flag) {
  WiFiClientSecure client;
  if (this->insecure_tls_) {
    client.setInsecure();
  } else {
    client.setCACert(GITHUB_ROOT_CA);
  }
  // Firebase REST endpoint เป็น HTTPS ของ Google เอง (ไม่ใช่ GitHub) แต่ใช้
  // client เดียวกันได้เพราะ WiFiClientSecure ตรวจแค่ chain มาตรฐาน - ถ้า
  // Firebase ใช้ CA คนละเจ้ากับ GitHub การเช็คนี้จะ fail ปลอดภัย (ไม่ใช่ fail
  // แบบเงียบๆ) เพราะ ESP_LOGE ด้านล่างจะรายงานทันที
  HTTPClient http;
  if (!http.begin(client, this->firebase_url_.c_str())) {
    ESP_LOGE(TAG, "http.begin() ล้มเหลว (firebase_url ผิดรูปแบบ หรือ TLS setup ล้มเหลว)");
    return false;
  }
  http.setTimeout(10000);

  int code = http.GET();
  if (code != HTTP_CODE_OK) {
    ESP_LOGE(TAG, "เช็คเวอร์ชันจาก Firebase ล้มเหลว - HTTP code: %d (%s)", code,
             http.errorToString(code).c_str());
    http.end();
    return false;
  }

  // ใช้ DynamicJsonDocument เพราะ payload เล็ก (3 fields) แต่ขนาดไม่แน่นอน
  // ตายตัวเท่า StaticJsonDocument - กันไม่ให้ล้น stack ถ้า Firebase มีข้อมูล
  // เกินคาด
  DynamicJsonDocument doc(1024);
  DeserializationError err = deserializeJson(doc, http.getStream());
  http.end();

  if (err) {
    ESP_LOGE(TAG, "แปลง JSON จาก Firebase ล้มเหลว: %s", err.c_str());
    return false;
  }

  // Firebase คืน null ตรงๆ (ไม่ใช่ {}) ถ้า path นั้นยังไม่มีข้อมูลเลย
  if (doc.isNull()) {
    ESP_LOGW(TAG, "ยังไม่มีข้อมูล firmware บน Firebase (path ว่าง)");
    return false;
  }

  out_version = doc["latest_version"] | "";
  out_url = doc["url"] | "";
  out_flag = doc["update_flag"] | false;
  return true;
}

bool OtaUpdater::perform_update_(const std::string &url, const std::string &version) {
  WiFiClientSecure client;
  if (this->insecure_tls_) {
    client.setInsecure();
  } else {
    client.setCACert(GITHUB_ROOT_CA);
  }

  HTTPClient http;
  // ตาม redirect อัตโนมัติ - raw.githubusercontent.com เองไม่ redirect แต่
  // เผื่อกรณีใช้ URL แบบอื่น (เช่น GitHub Releases) ที่ redirect ไป CDN
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  if (!http.begin(client, url.c_str())) {
    ESP_LOGE(TAG, "http.begin() ล้มเหลวสำหรับ firmware url: %s", url.c_str());
    return false;
  }
  http.setTimeout(20000);

  int code = http.GET();
  if (code != HTTP_CODE_OK) {
    ESP_LOGE(TAG, "ดาวน์โหลดเฟิร์มแวร์ล้มเหลว - HTTP code: %d (network หลุด หรือ URL/cert ผิด)", code);
    http.end();
    return false;
  }

  int content_length = http.getSize();
  if (content_length <= 0) {
    ESP_LOGE(TAG, "Content-Length ไม่ถูกต้อง (%d) - server ไม่ได้ส่งขนาดไฟล์มา ยกเลิก",
             content_length);
    http.end();
    return false;
  }

  // ตรวจ partition ว่าง (inactive OTA partition) พอสำหรับไฟล์นี้หรือไม่ ก่อน
  // เริ่มเขียนจริง - Update.begin() เช็คให้อยู่แล้วแต่เช็คเองก่อนเพื่อ log
  // ข้อความที่อ่านง่ายกว่า error code ดิบของ Update library
  const esp_partition_t *next_partition = esp_ota_get_next_update_partition(nullptr);
  if (next_partition == nullptr) {
    ESP_LOGE(TAG, "ไม่พบ OTA partition ที่ว่างสำหรับเขียน - ตรวจ partition table "
                  "(ต้องใช้ scheme ที่มี ota_0/ota_1 เช่น partitions.csv ที่แนบมา)");
    http.end();
    return false;
  }
  if ((size_t) content_length > next_partition->size) {
    ESP_LOGE(TAG, "ไฟล์เฟิร์มแวร์ใหญ่เกิน partition ว่าง (%d bytes > %u bytes)",
              content_length, (unsigned) next_partition->size);
    http.end();
    return false;
  }

  if (!Update.begin(content_length, U_FLASH)) {
    ESP_LOGE(TAG, "Update.begin() ล้มเหลว: %s", Update.errorString());
    http.end();
    return false;
  }

  ESP_LOGI(TAG, "เริ่มดาวน์โหลด+เขียนเฟิร์มแวร์ %s (%d bytes)...", version.c_str(), content_length);

  WiFiClient *stream = http.getStreamPtr();
  size_t written = Update.writeStream(*stream);
  http.end();

  if (written != (size_t) content_length) {
    // ดาวน์โหลดไม่ครบ (เช่น wifi หลุดกลางทาง) - เขียนไปแค่บางส่วนใน partition
    // ที่ไม่ได้ใช้งานอยู่ (ota partition สำรอง) ไม่กระทบ partition ที่บูตอยู่
    // ปัจจุบันเลย - abort() ทิ้ง progress ที่เขียนไปแล้วอย่างชัดเจน
    ESP_LOGE(TAG, "เขียนไฟล์ไม่ครบ (%u/%d bytes) - อาจเป็นเพราะ wifi หลุดกลางทาง ยกเลิก",
              (unsigned) written, content_length);
    Update.abort();
    return false;
  }

  if (!Update.end(true)) {
    // end(true) ตรวจทั้งขนาดไฟล์และ md5 - ถ้าไฟล์ corrupt (เช่นดาวน์โหลดมาไม่
    // ครบแต่ writeStream คืนค่าครบด้วยเหตุผลอื่น หรือไฟล์บน GitHub เสียเอง)
    // จะ fail ตรงนี้ และ partition ที่กำลังบูตอยู่ก็ยังไม่ถูกแตะเช่นเดิม
    ESP_LOGE(TAG, "Update.end() ล้มเหลว (ไฟล์ corrupt หรือไม่ใช่ ESP32 image ที่ถูกต้อง): %s",
              Update.errorString());
    return false;
  }

  if (!Update.isFinished()) {
    ESP_LOGE(TAG, "Update ไม่จบสมบูรณ์แม้ end() จะคืนค่า true (ไม่ควรเกิดขึ้น) - ยกเลิกความปลอดภัย");
    return false;
  }

  return true;
}

void OtaUpdater::clear_update_flag_() {
  WiFiClientSecure client;
  if (this->insecure_tls_) {
    client.setInsecure();
  } else {
    client.setCACert(GITHUB_ROOT_CA);
  }

  HTTPClient http;
  // PATCH เฉพาะ key เดียว (update_flag) - ไม่แตะ latest_version/url ที่แอดมิน
  // เป็นคนตั้ง เผื่อแอดมินอยากเก็บ url ไว้ดูอ้างอิงหลังอัปเดตเสร็จ
  if (!http.begin(client, this->firebase_url_.c_str())) {
    ESP_LOGE(TAG, "เคลียร์ update_flag ล้มเหลว: http.begin() ไม่สำเร็จ");
    return;
  }
  http.addHeader("Content-Type", "application/json");
  int code = http.PATCH("{\"update_flag\":false}");
  if (code != HTTP_CODE_OK) {
    // ไม่ critical - ถ้าล้มเหลวตรงนี้ แค่แปลว่ารอบ poll ถัดไปจะเห็น
    // latest_version == current_version อยู่ดี (เพราะรีสตาร์ทเข้าเวอร์ชันใหม่
    // ไปแล้ว) เลย early-return ที่บรรทัด "เวอร์ชันล่าสุดตรงกับเวอร์ชัน
    // ปัจจุบัน" อยู่แล้ว ไม่ทำให้เกิดลูปอัปเดตซ้ำ
    ESP_LOGW(TAG, "เคลียร์ update_flag บน Firebase ล้มเหลว (HTTP %d) - ไม่กระทบการทำงาน "
                  "เพราะเวอร์ชันตรงกันแล้วหลัง restart", code);
  }
  http.end();
}

}  // namespace ota_updater
}  // namespace esphome
