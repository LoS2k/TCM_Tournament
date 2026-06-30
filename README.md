# Tank Company Cup — Tournament Platform

Веб-платформа для проведення турнірів зі стрімами. Дані синхронізуються в реальному часі через Firebase Firestore — глядачі реєструють команди з будь-якого пристрою, адмін керує турніром, всі бачать оновлення миттєво.

## Структура

```
index.html      — головна сторінка / навігація
register.html   — реєстрація команд (для гравців)
public.html     — публічна сторінка результатів (для глядачів / OBS)
admin.html      — адмін-панель керування турніром
shared.js       — спільна логіка + підключення до Firebase
styles.css      — спільні стилі
```

## Деплой на Vercel

### Крок 1 — GitHub
1. Створи новий репозиторій на GitHub (наприклад `tank-company-tournament`)
2. Завантаж усі файли з цієї папки в репозиторій:
   ```
   git init
   git add .
   git commit -m "Initial tournament platform"
   git branch -M main
   git remote add origin https://github.com/ТВІЙ_НІК/tank-company-tournament.git
   git push -u origin main
   ```

### Крок 2 — Vercel
1. Йди на [vercel.com](https://vercel.com) → Sign in через GitHub
2. **Add New → Project**
3. Обери репозиторій `tank-company-tournament`
4. Framework Preset: **Other** (це звичайний статичний HTML, білд не потрібен)
5. Натисни **Deploy**
6. Через ~30 секунд отримаєш посилання типу `tank-company-tournament.vercel.app`

### Крок 3 — Firestore Security Rules
Зараз база в **test mode** — будь-хто може читати/писати. Це нормально для початку, але перед публічним стрімом онови правила:

Firebase Console → Firestore Database → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /tournaments/{document} {
      allow read: if true;
      allow write: if true; // TODO: додати авторизацію адміна пізніше
    }
  }
}
```

Це все ще відкритий доступ на запис — для production варто додати Firebase Authentication
для адмінки, щоб лише ти міг змінювати результати. Скажи якщо потрібно — додам.

## Як користуватись

1. Відкрий `/admin.html` → Налаштування → Зберегти → ввімкни реєстрацію
2. Розішли посилання `/register.html` командам — вони реєструються самостійно
3. Коли всі зареєструвались → Адмінка → **Запустити турнір**
4. На стрімі тримай відкритою `/public.html` (можна через OBS Browser Source)
5. Клікай на матч в адмінці → вводь рахунок → все оновлюється на публічній сторінці миттєво

## Локальний тест перед деплоєм

Просто відкрий `index.html` подвійним кліком у браузері — Firebase працює одразу,
білд/сервер не потрібен.
