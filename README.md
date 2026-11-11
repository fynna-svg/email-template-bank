# Email Template Bank

Springfield Properties' email template bank: projects, templates, previews and HTML exports for each sending account.

## What's in this folder

| File | What it is | Do you edit it? |
|---|---|---|
| `index.html` | The website itself | No |
| `config.js` | Your Supabase address and key | Yes, once (setup Step 5) |
| `backend.js` | Connects the website to Supabase | No |
| `vendor/supabase.js` | Supabase's own code library | No |
| `assets/` | Images used by some templates | No |
| `supabase-setup.sql` | Creates your database (run once in Supabase) | No |

Your templates are **not** stored in this repository. They live in your Supabase database, behind your sign-in.

## Everyday use

- **New project:** click **New project**, then **Project settings** to add the landing page links and WhatsApp details.
- **New email:** pick the project, click **New template** (blank) or open an email and click **Duplicate**.
- **Projects and emails prepared in Claude:** Claude sends you a `.json` file. Click **Import file** and choose it.
- **Backup:** click **Backup** now and then. It downloads everything as one file, which you can bring back with **Import file**.
- **Write with Claude buttons:** optional. Click **Claude key** and paste an API key from console.anthropic.com. It stays in your browser only.

## Updating the website

When Claude gives you a new `index.html` or `backend.js`:

1. On GitHub, open this repository and click **Add file**, then **Upload files**.
2. Drag the new file in.
3. Click **Commit changes**.

The website updates in about a minute.
