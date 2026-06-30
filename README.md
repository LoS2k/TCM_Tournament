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

### Крок 3 — Налаштування адміністратора (через Firestore, без email у коді)

Email адміна більше не зберігається у коді сайту — натомість права перевіряються
через окрему колекцію `admins` у Firestore, де ключ документа — це Google UID користувача.

**3.1 — Знайди свій UID:**
1. Firebase Console → **Authentication** → вкладка **Users**
2. Зайди на сайт (`admin.html`) → спробуй залогінитись через Google один раз
   (вхід поки що відхилить тебе як "не адміна" — це нормально, бо запису ще немає)
3. Поверніcь у Firebase Console → Authentication → Users — там з'явиться твій акаунт
   з колонкою **User UID** (довгий рядок типу `aB3xY...`). Скопіюй його.

**3.2 — Додай документ адміна в Firestore:**
1. Firebase Console → **Firestore Database** → вкладка **Data**
2. **Start collection** → Collection ID: `admins`
3. Document ID: встав свій **UID** (скопійований щойно)
4. Додай поле: `email` (тип string) = `pavlovskyjast@gmail.com` (для зручності, не обов'язково)
5. **Save**

Тепер коли логінишся через Google на сайті — система знаходить документ `admins/{твій UID}`,
бачить що він існує, і відкриває адмінку. Будь-хто інший без такого документа отримає
"немає прав адміністратора".

### Крок 4 — Firestore Security Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /tournaments/{document} {
      allow read: if true;
      allow write: if request.auth != null
                    && exists(/databases/$(database)/documents/admins/$(request.auth.uid));
    }

    match /admins/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if false; // додавати адмінів можна лише вручну з Firebase Console
    }
  }
}
```

⚠️ Це означає що **реєстрація команд через `register.html` теж вимагатиме прав адміна**,
бо запис у `tournaments/main` тепер захищений. Якщо хочеш щоб глядачі реєструвались
без логіну (як домовлялись раніше) — напиши мені, і я переведу команди в окрему
підколекцію `tournaments/main/teams/{id}` з окремим відкритим правилом `allow create: if true`,
а решту документа (формат, матчі, інфо) залишу захищеною лише для адміна.

Натисни **Publish** після зміни правил у Firebase Console.

## Як користуватись

1. Відкрий `/admin.html` → Налаштування → Зберегти → ввімкни реєстрацію
2. Розішли посилання `/register.html` командам — вони реєструються самостійно
3. Коли всі зареєструвались → Адмінка → **Запустити турнір**
4. На стрімі тримай відкритою `/public.html` (можна через OBS Browser Source)
5. Клікай на матч в адмінці → вводь рахунок → все оновлюється на публічній сторінці миттєво

## Локальний тест перед деплоєм

Просто відкрий `index.html` подвійним кліком у браузері — Firebase працює одразу,
білд/сервер не потрібен.
