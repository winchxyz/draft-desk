// EDIT ME: the folder you unpacked Draft Desk into (forward slashes work on Windows too),
// your Telegram chat id (message @userinfobot to get it), and the reply filters.
return [{ json: {
  kit_dir: 'C:/Users/you/draft-desk',
  chat_id: '123456789',
  min_followers: 20000, // accounts outside the watchlist need at least this many followers
  min_velocity: 60, // and their post needs at least this many likes per hour
  max_age_hours: 3, // a reply under an older post earns almost nothing
} }];
