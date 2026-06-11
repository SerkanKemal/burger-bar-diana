# Burger Bar & Bagel Diana

## Стартиране

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

След това отвори `http://localhost:3000`.

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
