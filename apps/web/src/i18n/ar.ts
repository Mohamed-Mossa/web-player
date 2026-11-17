import type { Dict } from './en';

export const ar: Dict = {
  nav: { home: 'الرئيسية', search: 'بحث', movies: 'أفلام', series: 'مسلسلات', live: 'قنوات', settings: 'الإعدادات', profiles: 'الحسابات' },
  common: {
    cancel: 'إلغاء', save: 'حفظ', delete: 'حذف', close: 'إغلاق', back: 'رجوع', retry: 'إعادة المحاولة', loading: 'جارٍ التحميل…',
    all: 'الكل', any: 'أي', yes: 'نعم', no: 'لا', done: 'تم', edit: 'تعديل', add: 'إضافة', refresh: 'تحديث',
    unlimited: 'غير محدود', minutes: '{{count}} دقيقة', comingPhase: 'التشغيل هيتضاف في المرحلة {{n}}',
  },
  home: {
    welcome: 'ضيف قائمة تشغيل عشان تبدأ', addPlaylist: 'إضافة قائمة', continue: 'كمّل المشاهدة',
    favorites: 'المفضلة', recentMovies: 'أفلام مضافة حديثًا', recentSeries: 'مسلسلات محدثة حديثًا',
    expiresSoon: 'اشتراك {{name}} هينتهي بعد {{count}} يوم', expired: 'اشتراك {{name}} انتهى',
    syncing: 'جارٍ تحديث {{name}}…', syncFailed: 'تعذر تحديث {{name}}: {{error}}',
  },
  sources: {
    title: 'قوائم التشغيل', add: 'إضافة قائمة', xtream: 'Xtream Codes', m3u: 'رابط M3U', name: 'الاسم',
    server: 'عنوان السيرفر', username: 'اسم المستخدم', password: 'كلمة السر', m3uUrl: 'رابط القائمة', epgUrl: 'رابط دليل البرامج (اختياري)',
    connect: 'اتصال', connecting: 'جارٍ الاتصال…', status: 'الحالة', expires: 'ينتهي في', connections: 'الاتصالات',
    connectionsValue: '{{active}} من {{max}} مستخدمة', created: 'تاريخ الإنشاء', ping: 'سرعة الاستجابة', lastSync: 'آخر تحديث',
    never: 'لم يتم', syncNow: 'حدّث الآن', remove: 'حذف القائمة', removeConfirm: 'حذف «{{name}}» ومحتواها من الجهاز ده؟',
    counts: '{{movie}} فيلم · {{series}} مسلسل · {{live}} قناة', trial: 'تجريبي',
    detectedXtream: 'الرابط فيه بيانات دخول Xtream. هيتضاف كـ Xtream عشان تظهر بيانات الاشتراك والتحديث يبقى أسرع.',
    errors: {
      auth: 'اسم المستخدم أو كلمة السر غلط.', expired: 'الاشتراك ده منتهي.', banned: 'الحساب ده موقوف.',
      network: 'مش قادر أوصل للسيرفر. اتأكد من الرابط، أو حط بروكسي في الإعدادات لنسخة الويب.',
      format: 'السيرفر رد بشكل غير متوقع.', required: 'من فضلك املأ كل الحقول.',
    },
    step: { categories: 'قراءة الأقسام', live: 'قراءة القنوات', movies: 'قراءة الأفلام', series: 'قراءة المسلسلات', saving: 'حفظ', index: 'تجهيز البحث', m3u: 'تحميل القائمة' },
  },
  catalog: {
    categories: 'الأقسام', allCategories: 'الكل', manage: 'تنظيم', doneManaging: 'تم', hide: 'إخفاء', show: 'إظهار',
    rename: 'إعادة تسمية', moveUp: 'لفوق', moveDown: 'لتحت', reset: 'الاسم الأصلي', hidden: 'مخفي',
    sort: 'ترتيب', sortAdded: 'المضاف حديثًا', sortName: 'الاسم', sortYear: 'السنة', sortRating: 'التقييم',
    genre: 'النوع', year: 'السنة', rating: 'التقييم', older: 'أقدم', ratingMin: '{{n}}+', empty: 'مفيش حاجة هنا لسه',
    noResults: 'مفيش نتائج بالفلاتر دي', items: '{{count}} عنوان', channels: '{{count}} قناة', filters: 'فلاتر', clear: 'مسح',
  },
  details: {
    play: 'تشغيل', trailer: 'الإعلان', favorite: 'للمفضلة', unfavorite: 'شيل من المفضلة', cast: 'الممثلين',
    similar: 'أعمال مشابهة', inLibrary: 'موجود عندك', seasons: 'المواسم', episodes: 'الحلقات', season: 'الموسم {{n}}',
    alsoIn: 'متاح كمان في', director: 'المخرج', notFound: 'العنوان ده مبقاش موجود في القائمة.',
  },
  search: { placeholder: 'دوّر على فيلم أو مسلسل أو قناة…', empty: 'اكتب للبحث في كل القوائم', none: 'مفيش نتائج لـ «{{q}}»', building: 'جارٍ تجهيز البحث…' },
  profiles: {
    who: 'مين بيتفرج؟', add: 'إضافة حساب', edit: 'تعديل الحساب', name: 'اسم الحساب', pin: 'رمز PIN (اختياري، 4 أرقام)',
    enterPin: 'اكتب الـ PIN لحساب {{name}}', wrongPin: 'الرمز غلط', removePin: 'إلغاء الـ PIN', setPin: 'تعيين PIN', manage: 'إدارة الحسابات', me: 'أنا',
  },
  settings: {
    title: 'الإعدادات', language: 'اللغة', layout: 'شكل الواجهة', layoutAuto: 'تلقائي', layoutTv: 'تليفزيون', layoutDesktop: 'كمبيوتر',
    layoutMobile: 'موبايل', proxy: 'رابط البروكسي (نسخة الويب)', proxyHint: 'عنوان الـ Cloudflare Worker بتاعك. سيبه فاضي على أندرويد.',
    refresh: 'تحديث المحتوى كل', hours: '{{count}} ساعة', playlists: 'قوائم التشغيل', profiles: 'الحسابات', about: 'عن التطبيق',
    version: 'الإصدار', build: 'البناء', updateReady: 'فيه إصدار جديد جاهز', reload: 'إعادة تحميل',
  },
};
