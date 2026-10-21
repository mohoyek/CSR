/**
 * فرضیات — مقادیر پیش‌فرض برای ابهام‌های راهنمای GICA
 * (GICA.SW.User.CertProfilev1.0 rev 1.0، 1404/07/25)
 *
 * هر ابهامی که در راهنما پاسخ صریح ندارد، اینجا به‌صورت یک ثابت
 * پیاده‌سازی شده است تا در یک نقطه قابل تغییر و بازبینی باشد.
 * همین فهرست در README (بخش «فرضیات قابل تأیید») و در رابط کاربری
 * (راهنمای «فرضیات») نمایش داده می‌شود.
 */

/**
 * فرضیات ۱ — واحدهای سازمانی (OU)
 *
 * نمونهٔ config.txt راهنما سه واحد با نام‌های 3.OU/2.OU/1.OU دارد،
 * ولی جدول پیوست‌ها «نام سازمان» + سه واحد را جداگانه فهرست می‌کند.
 * طبق درخواست نهایی، فیلدهای واحدهای ۱ تا ۳ حذف شده‌اند و فقط
 * «نام سازمان» به‌عنوان یک OU (با شمارهٔ 1.OU) پشتیبانی می‌شود —
 * دقیقاً همان چیزی که در نمونهٔ کاربردی راهنما دیده می‌شود.
 */
export const ASSUMED_OU_UNIT_COUNT = 0;

/**
 * فرضیات ۲ — ترتیب RDN در پروفایل‌های ۱ و ۳
 *
 * راهنما فقط برای پروفایل ۲ (نمونهٔ کاربردی) ترتیب DN را نشان می‌دهد:
 *   CN, serialNumber, O, 3.OU, 2.OU, 1.OU, L, ST, C
 * پیش‌فرض: همین الگو برای هر سه پروفایل؛ فیلدهای اضافه بلافاصله پس از
 * serialNumber و به ترتیب جدول پیوست قرار می‌گیرند.
 */
export const ASSUMED_BASE_SUBJECT_ORDER = [
  'cn',
  'serialNumber',
  'o',
  'ouOrg',
  'l',
  'st',
  'c',
] as const;

/**
 * پروفایل ۱ — فیلدهای اضافه پس از serialNumber به ترتیب جدول: E, SN, GN, T, 2.5.4.97
 * (نقش سازمانی و شناسهٔ سازمان فقط برای انواع Gov/NGO هستند و در «مستقل» ظاهر
 * نمی‌شوند)
 */
export const ASSUMED_PROFILE_1_SUBJECT_ORDER = [
  'cn',
  'serialNumber',
  'e',
  'sn',
  'gn',
  'title',
  'orgId',
  'o',
  'ouOrg',
  'l',
  'st',
  'c',
] as const;

/** پروفایل ۲ — فقط E اضافه است (پس از serialNumber، به ترتیب جدول) */
export const ASSUMED_PROFILE_2_SUBJECT_ORDER = [
  'cn',
  'serialNumber',
  'e',
  'o',
  'ouOrg',
  'l',
  'st',
  'c',
] as const;

/** پروفایل ۳ — Surname و GivenName اضافه‌اند (پس از serialNumber، به ترتیب جدول) */
export const ASSUMED_PROFILE_3_SUBJECT_ORDER = [
  'cn',
  'serialNumber',
  'sn',
  'gn',
  'o',
  'ouOrg',
  'l',
  'st',
  'c',
] as const;

/**
 * فرضیات ۳ — قالب CN پروفایل ۳ (دفتر ثبت‌نام)
 * راهنما می‌نویسد «RaName. RA [National Code]»؛ نقطه‌گذاری دقیق مشخص نیست.
 * پیش‌فرض: همان متن راهنما، با «.» بعد از RaName و «[کد ملی]» در انتها.
 */
export const ASSUMED_CN_TEMPLATE_P3 = '{raName}. RA [{raNationalCode}]';

/**
 * فرضیات ۴ — ترتیب فیلدها
 * تصاویر راهنما ترتیب متفاوتی از متن نمونه نشان می‌دهند؛ متن نمونه
 * (config.txt) ملاک است و در این پیاده‌سازی همان ترتیب رعایت شده است.
 */
export const ASSUMED_FIELD_ORDER_SOURCE = 'config.txt' as const;

export interface Assumption {
  id: number;
  title: string;
  guide: string;
  default: string;
}

export const ASSUMPTIONS: Assumption[] = [
  {
    id: 1,
    title: 'واحدهای سازمانی (OU)',
    guide: 'نمونهٔ config.txt راهنما سه واحد 3.OU/2.OU/1.OU دارد، ولی جدول پیوست‌ها «نام سازمان» + سه واحد را جداگانه فهرست می‌کند.',
    default: 'فیلدهای واحدهای ۱ تا ۳ حذف شده‌اند؛ فقط «نام سازمان» به‌عنوان یک OU با شمارهٔ 1.OU تولید می‌شود (مانند نمونهٔ کاربردی راهنما).',
  },
  {
    id: 2,
    title: 'ترتیب RDN در پروفایل‌های ۱ و ۳',
    guide: 'راهنما فقط برای پروفایل ۲ ترتیب DN را نمونه می‌دهد.',
    default: 'همان الگوی نمونه (CN, serialNumber, O, OUها, L, ST, C)؛ فیلدهای اضافه بلافاصله پس از serialNumber و به ترتیب جدول پیوست.',
  },
  {
    id: 3,
    title: 'قالب CN پروفایل ۳',
    guide: 'راهنما می‌نویسد «RaName. RA [National Code]» ولی نقطه‌گذاری دقیق مشخص نیست.',
    default: ASSUMED_CN_TEMPLATE_P3,
  },
  {
    id: 4,
    title: 'ترتیب فیلدها',
    guide: 'تصاویر راهنما ترتیب متفاوتی از متن نمونه نشان می‌دهند.',
    default: 'متن نمونه (config.txt) ملاک است؛ ترتیب فیلدها مطابق همان نمونه پیاده شده است.',
  },
];
