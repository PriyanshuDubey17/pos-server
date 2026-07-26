# Deploy backend on Vercel

## Project setup

1. Import the repo in Vercel.
2. Set **Root Directory** to `backend`.
3. Framework Preset: Other (Node).
4. Add environment variables (below), then Deploy.

Local development is unchanged: `node server.js` or `npm run dev` (nodemon).

## Environment variables

Set these in Vercel → Project → Settings → Environment Variables (Production):

| Variable | Notes |
|----------|--------|
| `NODE_ENV` | `production` |
| `MONGO_URI` | MongoDB Atlas connection string (replica set required for sales transactions) |
| `JWT_SECRET` | Access token secret |
| `JWT_REFRESH_SECRET` | Refresh token secret |
| `CLIENT_URL` | Public web client origin, no trailing slash (e.g. `https://your-app.vercel.app`) |
| `ADMIN_URL` | Admin panel origin, no trailing slash |
| `CLOUDINARY_CLOUD_NAME` | If menu/profile image upload is used |
| `CLOUDINARY_API_KEY` | |
| `CLOUDINARY_API_SECRET` | |
| `SMS_PROVIDER` | e.g. `dlt` / `twilio` |
| `DLT_API_KEY` / Twilio vars | Matching your SMS provider |
| `EMAIL_PROVIDER` | e.g. `sendgrid` |
| `SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL` | If email is used |

Do not commit `.env`.

## CORS + cookies

- Production auth cookies use `sameSite: "none"` and `secure: true` so the admin panel on another origin can send credentials.
- `CLIENT_URL` and `ADMIN_URL` must match the browser `Origin` exactly (scheme + host, no trailing `/`).

## After deploy — update clients

| Client | Env var | Example value |
|--------|---------|----------------|
| admin-panel | `VITE_APP_URL` | `https://<your-backend>.vercel.app/api` |
| admin-mobile | `EXPO_PUBLIC_API_URL` | `https://<your-backend>.vercel.app/api` |

## Smoke check

- Unknown path should return JSON 404 from Express, e.g. `GET https://<your-backend>.vercel.app/api/does-not-exist`
- Then test admin login OTP / refresh with the updated client URL
