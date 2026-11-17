import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { ar } from './ar';
import { useApp, type Lang } from '../state/app';

export function applyDocumentLang(lang: Lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: useApp.getState().lang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});
applyDocumentLang(useApp.getState().lang);

useApp.subscribe((s, prev) => {
  if (s.lang !== prev.lang) {
    i18n.changeLanguage(s.lang);
    applyDocumentLang(s.lang);
  }
});

export const isRtl = () => document.documentElement.dir === 'rtl';
export default i18n;
