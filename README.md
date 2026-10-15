# Spirit Champions Book Reading Club · HQ site

The HQ team site for the Spirit Champions Book Reading Club: the team chart, the session programme, the session register, the club's published articles and the team's admin area.

Live: https://spirit-champions-hq.vercel.app

| Page | Path | Who uses it |
| --- | --- | --- |
| Team chart | `/` | Anyone with the link, including HSRM |
| Session 1 programme | `/programme` | Readers; has a QR code to the register |
| Session register | `/register` | Readers sign in on arrival, and add their takeaway under "Before you leave" |
| Paper register | `/print-register` | A4 sheet for readers without phones |
| Articles | `/articles` | Anyone with the link: the club's published session write-ups |
| Article: Reclaiming Africa's Spiritual Identity | `/articles/reclaiming-africas-spiritual-identity` | The Session 1 book review, with the review cards and photographs |
| Admin | `/admin` | Team members: members and photos, the register (CSV download), team access |

## Adding an article

1. Put the text and the pictures in a folder, the way `new_article/` holds the Session 1 material: `article.txt` plus the images.
2. Make web-sized images in `assets/articles/<article-slug>/` with `convert` (ImageMagick), keeping each file under about 200 KB: a `hero.jpg` band about 1600 px wide, a `card.jpg` portrait about 640x800 for the list, and one image per gallery item. ImageMagick alone is enough; no other tooling is needed.
3. Copy an existing article page, e.g. `articles/reclaiming-africas-spiritual-identity.html`, to `articles/<article-slug>.html`, and replace the title, blurb, byline, text, images and the "In this article" list. Keep the header, the breadcrumb line, the `art-hero` band and the footer as they are.
4. Add a card to `articles.html`: copy the `<article class="art-item">` block, change the eyebrow, title and link, and point it at the new page. The count in the strip follows the list on its own.
5. The hub page and the articles folder share a name, so `vercel.json` carries a rewrite from `/articles` to `/articles.html`; leave it in place.

## How it is built

- **Static site** (plain HTML, CSS and JavaScript, no build step), hosted on Vercel (team "MSRI system", project `spirit-champions-hq`). `vercel.json` sets clean URLs, the `/articles` rewrite for the article hub and `noindex` headers.
- **Supabase** (the AHV project, `cuvkisbvazskxwqbjtdw`) holds the data. Every object for this site is prefixed `sc_`:
  - `sc_members`: the people on the chart. Anyone can read; team members can add, edit and remove.
  - `sc_team_access`: emails allowed to sign in, admin flag, hashed one-time join codes.
  - `sc_attendance` and `sc_takeaways`: the session register. Anyone can add a row; only team members can read; only admins can delete.
  - Storage bucket `sc-member-photos` for member photos (public read, team write).
- **Sign-in** is Supabase email and password. No emails are sent: an admin adds an email under Team access and gets a 6-digit join code to send on WhatsApp. The person uses it once at `/admin` → "First time or new code" to set a password. This is handled by the `sc-join` edge function, which uses the service role key the Supabase platform provides to the function; no secret is stored in this repository.
- `assets/common.js` contains the Supabase project URL and **publishable** key, which are meant to be public. Access is enforced by row-level security in the database.

## Deploying changes

- **Site:** connect this repository to the Vercel project `spirit-champions-hq` (Settings → Git), then every push to `main` deploys. No build command; output directory is the repository root.
- **Database:** the SQL in `supabase/migrations/` has already been applied. New changes go in a new, later-dated file.
- **Edge function:** `supabase functions deploy sc-join --no-verify-jwt`.

Note: `supabase/migrations/20261015060000_spirit_champions_team_chart.sql` also adds a guard to the AHV project's `handle_new_user()` trigger so that club accounts (app metadata `app = spirit-champions`) are not created as AHV applicants.
