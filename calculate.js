// calculate.js — สูตรคำนวณค่าไฟ WattWise (ข้อ 4 + ตัวช่วยข้อ 6 และ 8)
// ใช้ได้ทั้ง <script type="module"> และ import ใน React/HTML ธรรมดา
// หมายเหตุ: ค่าตัวคูณทั้งหมดเป็น "ค่าเริ่มต้นสมมติ" ไม่ใช่ค่าจากงานวิจัย
// ให้ปรับด้วยข้อมูลจริงจาก Smart Plug (ข้อ 8)

// ตัวคูณ [ต่ำสุด, สูงสุด] ของแอร์ ตามทิศห้อง
export const ORIENTATION_FACTOR = {
  north: [1.0, 1.05],
  east:  [1.0, 1.05],
  south: [1.05, 1.15],
  west:  [1.1, 1.2],
};

// ตัวคูณตามอายุแอร์ (ปี) -> [ต่ำสุด, สูงสุด]
export function ageFactor(years) {
  if (years < 3) return [1.0, 1.0];
  if (years <= 7) return [1.05, 1.1];
  return [1.15, 1.25];
}

// แอร์ไม่ได้กินไฟเต็ม Watt บนฉลากตลอดเวลา (คอมเพรสเซอร์ตัด/ต่อ)
// duty cycle = สัดส่วนที่ทำงานจริง [ต่ำสุด, สูงสุด] (ค่าสมมติ ให้ปรับด้วยข้อมูลจริง)
export const AC_DUTY_CYCLE = [0.5, 0.8];

// สัดส่วนเวลาที่เครื่องกินไฟจริงตามประเภท [ต่ำสุด, สูงสุด] (ค่าสมมติเริ่มต้น ต้องปรับตามผลวัดจริง)
export const TYPE_DUTY = {
  ac: AC_DUTY_CYCLE,
  fridge: [0.3, 0.5],     // คอมเพรสเซอร์ตัด-ต่อ
  fan: [1, 1],
  tv: [1, 1],
  computer: [0.5, 1.0],   // ตอนว่างกับตอนโหลดหนักต่างกัน
  lighting: [1, 1],
  heater: [0.3, 0.6],     // เทอร์โมสตัทตัด-ต่อ
  other: [1, 1],
};

// ความไม่แน่นอนของชั่วโมงใช้งาน (±20% ถ้าผู้ใช้ไม่ระบุช่วง)
const HOURS_UNCERTAINTY = 0.2;

export function daysInMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// ตัวคูณสึกหรอของเครื่องทั่วไปตามอายุ [ต่ำสุด, สูงสุด] (ค่าสมมติ) ถ้าไม่ทราบอายุ = ช่วงกว้างขึ้น
export function applianceAgeFactor(years) {
  if (years == null || Number.isNaN(years)) return [1.0, 1.15];
  if (years < 5) return [1.0, 1.0];
  if (years <= 10) return [1.0, 1.1];
  return [1.05, 1.25];
}

// ตัวคูณตามสภาพเครื่อง (ค่าสมมติ): ไม่ระบุ = normal
export const CONDITION_FACTOR = {
  new:    [1.0, 1.0],
  normal: [1.0, 1.05],
  old:    [1.1, 1.3],   // เก่า/สกปรก/ซีลเสื่อม
  faulty: [1.3, 1.6],   // มีอาการผิดปกติ เช่น ทำงานไม่หยุด ไม่ค่อยเย็น
};

/**
 * คำนวณต่อเครื่อง
 * appliance = {
 *   name, type: 'ac' | 'other', watts, hoursPerDay,
 *   hoursMin?, hoursMax?,
 *   ageYears?,                      // ไม่ทราบ = เว้นว่าง
 *   condition?: 'new'|'normal'|'old'|'faulty',
 *   measuredWatts?,                 // วัตต์ที่วัดจริง (ถ้ามี จะไม่คูณตัวสึกหรอซ้ำ)
 *   orientation?                    // ใช้เฉพาะแอร์
 * }
 */
export function estimateAppliance(appliance, ratePerKwh) {
  const { hoursPerDay, type } = appliance;
  const measured = appliance.measuredWatts > 0;
  const watts = measured ? appliance.measuredWatts : appliance.watts;
  const hMin = appliance.hoursMin ?? hoursPerDay * (1 - HOURS_UNCERTAINTY);
  const hMax = appliance.hoursMax ?? hoursPerDay * (1 + HOURS_UNCERTAINTY);

  // แต่ละแหล่งความไม่แน่นอน = ช่วง [ต่ำ, สูง]
  const duty = TYPE_DUTY[type] ?? [1, 1];
  const factors = [duty];
  if (type === 'ac') factors.push(ORIENTATION_FACTOR[appliance.orientation] ?? [1.0, 1.1]);
  if (!measured) {
    factors.push(type === 'ac' && appliance.ageYears != null
      ? ageFactor(appliance.ageYears) : applianceAgeFactor(appliance.ageYears));
    factors.push(CONDITION_FACTOR[appliance.condition] ?? CONDITION_FACTOR.normal);
  }

  // ค่ากลาง = ชั่วโมงกลาง x ค่ากลางของทุกตัวคูณ
  const mid = (f) => (f[0] + f[1]) / 2;
  const expKwh = (watts * hoursPerDay * factors.reduce((p, f) => p * mid(f), 1)) / 1000;

  // ช่วงที่น่าจะเป็น: รวมความไม่แน่นอนแบบอิสระ (root-sum-square) ไม่ใช่เอาค่าแย่สุด/ดีสุดมาคูณพร้อมกัน
  // (ประมาณการเชิงฮิวริสติก ไม่ใช่ช่วงความเชื่อมั่นทางสถิติ)
  const rel = (f) => (f[1] - f[0]) / (f[1] + f[0]);
  const w = Math.sqrt([[hMin, hMax], ...factors].reduce((s, f) => s + rel(f) ** 2, 0));
  const kwhDay = { min: expKwh * (1 - w), expected: expKwh, max: expKwh * (1 + w) };
  const costDay = {
    min: kwhDay.min * ratePerKwh,
    expected: kwhDay.expected * ratePerKwh,
    max: kwhDay.max * ratePerKwh,
  };
  return { name: appliance.name, kwhDay, costDay };
}

/**
 * คำนวณรวมทั้งห้อง ทั้งเดือน
 * คืน { perAppliance, daily: {min,expected,max}, monthly: {min,expected,max} }
 * calibrationFactor: ตัวปรับจากข้อ 8 (ค่าเริ่มต้น 1)
 */
export function estimateRoom(appliances, ratePerKwh, days = daysInMonth(), calibrationFactor = 1) {
  const perAppliance = appliances.map((a) => estimateAppliance(a, ratePerKwh));
  const sum = (key) =>
    perAppliance.reduce((s, r) => s + r.costDay[key], 0) * calibrationFactor;

  const exp = sum('expected');
  const sd = Math.sqrt(perAppliance.reduce((s, r) => s + ((r.costDay.max - r.costDay.min) / 2) ** 2, 0)) * calibrationFactor;
  const daily = { min: Math.max(0, exp - sd), expected: exp, max: exp + sd };
  const monthly = {
    min: daily.min * days,
    expected: daily.expected * days,
    max: daily.max * days,
  };
  return { perAppliance, daily, monthly };
}

// ---------- ข้อ 6: งบรายวัน + แจ้งเตือน ----------
export function dailyBudget(monthlyBudget, date = new Date()) {
  return monthlyBudget / daysInMonth(date);
}

// คืน null ถ้ายังไม่เกิน, คืนข้อความถ้าเกิน
export function checkBudgetAlert(todayCost, monthlyBudget, date = new Date()) {
  const limit = dailyBudget(monthlyBudget, date);
  if (todayCost <= limit) return null;
  return `Used ${todayCost.toFixed(0)} THB today (over the daily budget of ${limit.toFixed(2)} THB)`;
}

// ---------- ข้อ 8: Calibrate ----------
// measuredKwh = ค่าจริงจาก Smart Plug, estimatedKwh = ค่าที่สูตรคำนวณ
// ใช้เฉลี่ยหลายวันจะนิ่งกว่าวันเดียว
export function calibrationFactor(measuredKwh, estimatedKwh) {
  if (!estimatedKwh) return 1;
  return measuredKwh / estimatedKwh;
}

// ---------- รับค่าวัตต์จาก ESP32 ----------
// prev/next = {t: เวลา(ms), w: วัตต์}  คืนค่า kWh ระหว่างสองจุด (ค่าเฉลี่ยของสองจุด × เวลา)
// ถ้าห่างกันเกิน maxGapSec (อุปกรณ์หลุดออฟไลน์) จะนับแค่ maxGapSec เพื่อไม่เกินจริง
export function kwhStep(prev, next, maxGapSec = 600) {
  const dt = (next.t - prev.t) / 1000;
  if (!(dt > 0)) return 0;
  return (((prev.w + next.w) / 2) * Math.min(dt, maxGapSec)) / 3600 / 1000;
}

// รวม kWh จากรายการ samples [{t, w}, ...] เรียงตามเวลา
export function kwhFromSamples(samples, maxGapSec = 600) {
  let kwh = 0;
  for (let i = 1; i < samples.length; i++) kwh += kwhStep(samples[i - 1], samples[i], maxGapSec);
  return kwh;
}
