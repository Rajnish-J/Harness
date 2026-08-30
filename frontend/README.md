This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Database

The workflows UI reads and writes Postgres, so `/workflows` needs a database
before it renders anything. Drizzle owns every application table; the Python
harness only reads them.

Local setup (Windows, PostgreSQL 17 installed under `C:\Program Files\PostgreSQL\17`):

```bash
# The cluster lives outside Program Files so it can be created without admin.
"/c/Program Files/PostgreSQL/17/bin/initdb.exe" --pgdata=C:/Users/<you>/pgdata/harness   --username=postgres --encoding=UTF8 --auth=scram-sha-256 --pwfile=<file with the password>
createdb -h localhost -U postgres harness
```

It is registered as the `postgresql-harness` Windows service (StartType
Automatic), so it comes back after a reboot. Start or stop it by hand with:

```powershell
Start-Service postgresql-harness
Stop-Service  postgresql-harness
```

Then point `DATABASE_URL` at it in `frontend/.env` (and `backend/.env`, which
shares the same database) and apply the migrations:

```bash
npm run db:migrate
```

If the page shows a "Cannot reach Postgres" or "tables are missing" banner,
those two steps are what it is asking for.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and self-host [Ubuntu](https://fonts.google.com/specimen/Ubuntu) (the app-wide sans) and [Outfit](https://fonts.google.com/specimen/Outfit) (available as the `font-display` utility), alongside Geist Mono for code.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
