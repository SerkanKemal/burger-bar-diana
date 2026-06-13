# Burger Bar & Bagel Diana

## Стартиране

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

След това отвори `http://localhost:3000`.

## MySQL и реални поръчки

Проектът записва поръчките в MySQL. Копирай `.env.example` като `.env` и попълни реалните данни:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=твоята_mysql_парола
DB_NAME=burger_bar_diana
```

Създай базата и таблиците:

```powershell
npm run db:init
```

След това стартирай:

```powershell
npm run dev
```

- Клиентите изпращат и проверяват поръчките през количката.
- Управлението е на `http://localhost:3000/admin.html`.
- Регистрирай профил и го направи администратор с `npm run admin:promote -- admin@example.com`.
- Управлението на поръчките е на `http://localhost:3000/admin.html` и използва нормалния вход в профила.
- Бутонът **Профил** позволява регистрация, вход и редакция на клиентските данни.
- Поръчките, направени след вход, се пазят в историята на профила.
- При промяна на статуса се създава известие в клиентския профил.
- Известията в тази версия са вътрешни за сайта. Имейл и SMS известия изискват отделен доставчик.

## Имейли при регистрация и поръчка

Добави SMTP настройките в `.env`. Пример с Gmail:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_16_character_app_password
EMAIL_FROM=Burger Bar Diana <your_email@gmail.com>
```

За Gmail активирай **2-Step Verification**, след което създай **App Password** за сайта. Не използвай обикновената парола на Google профила. След промяна на `.env` рестартирай сървъра.

Провери конфигурацията на:

```text
http://localhost:3000/api/health
```

Полето `email` трябва да бъде `configured`.

Изпрати пробен приветствен имейл:

```powershell
npm run email:test
```

За публичния Render сайт е необходима публично достъпна MySQL база. Локалната MySQL база на компютъра не е достъпна от Render. В Render добави `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` и `DB_NAME` като Environment Variables.

## Тестови плащания с карта чрез Stripe

Добави тестовите Stripe ключове и webhook secret като Environment Variables:

```env
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Webhook адресът за публичния сайт е:

```text
https://burger-bar-diana.onrender.com/api/stripe/webhook
```

Webhook-ът трябва да получава събитията `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` и `checkout.session.expired`. Поръчка с карта се маркира като платена само след валидно подписано потвърждение от Stripe.

Не поставяй Stripe secret key или webhook secret в HTML, JavaScript файловете или GitHub. За тестово успешно плащане използвай карта `4242 4242 4242 4242`, бъдеща дата и произволен CVC.

## Оптимизиране на изображенията

Оригиналните PNG файлове се пазят като източник, а сайтът зарежда по-малките WebP версии. След добавяне или смяна на PNG снимка изпълни:

```powershell
npm run optimize:images
```

След това провери и публикувай новите WebP файлове.

## Автоматични Google отзиви

1. Създай проект в [Google Cloud Console](https://console.cloud.google.com/).
2. Активирай **Places API (New)** и billing за проекта.
3. Създай API ключ и го ограничи до Places API и IP адреса на сървъра.
4. Намери Google Place ID на заведението.
5. В `.env` попълни:

```env
GOOGLE_PLACES_API_KEY=реалният_api_ключ
GOOGLE_PLACE_ID=реалният_place_id
PORT=3000
```

Рестартирай сървъра след промяна на `.env`.

Страницата проверява за актуални данни при зареждане и на всеки 15 минути. Google Places API връща актуалния общ рейтинг и броя оценки, но предоставя максимум пет отзива, подредени по релевантност. API ключът не трябва да се поставя в `burger-bar-diana/script.js` или `index.html`.

Официална документация:

- [Place Details (New)](https://developers.google.com/maps/documentation/places/web-service/place-details)
- [Places API policies and attributions](https://developers.google.com/maps/documentation/places/web-service/policies)
