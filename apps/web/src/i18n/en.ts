export const en = {
  nav: { home: 'Home', search: 'Search', movies: 'Movies', series: 'Series', live: 'Live TV', settings: 'Settings', profiles: 'Profiles' },
  common: {
    cancel: 'Cancel', save: 'Save', delete: 'Delete', close: 'Close', back: 'Back', retry: 'Retry', loading: 'Loading…',
    all: 'All', any: 'Any', yes: 'Yes', no: 'No', done: 'Done', edit: 'Edit', add: 'Add', refresh: 'Refresh',
    unlimited: 'Unlimited', minutes: '{{count}} min', comingPhase: 'Playback arrives in phase {{n}}',
  },
  home: {
    welcome: 'Add a playlist to get started', addPlaylist: 'Add playlist', continue: 'Continue watching',
    favorites: 'Favorites', recentMovies: 'Recently added movies', recentSeries: 'Recently updated series',
    expiresSoon: '{{name}} expires in {{count}} days', expired: '{{name}} has expired',
    syncing: 'Updating {{name}}…', syncFailed: 'Could not update {{name}}: {{error}}',
  },
  sources: {
    title: 'Playlists', add: 'Add playlist', xtream: 'Xtream Codes', m3u: 'M3U URL', name: 'Name',
    server: 'Server URL', username: 'Username', password: 'Password', m3uUrl: 'Playlist URL', epgUrl: 'EPG URL (optional)',
    connect: 'Connect', connecting: 'Connecting…', status: 'Status', expires: 'Expires', connections: 'Connections',
    connectionsValue: '{{active}} of {{max}} in use', created: 'Created', ping: 'Response time', lastSync: 'Last updated',
    never: 'Never', syncNow: 'Update now', remove: 'Remove playlist', removeConfirm: 'Remove “{{name}}” and its catalog from this device?',
    counts: '{{movie}} movies · {{series}} series · {{live}} channels', trial: 'Trial',
    detectedXtream: 'This link contains Xtream login details. It will be added as Xtream for account info and faster updates.',
    errors: {
      auth: 'Wrong username or password.', expired: 'This subscription has expired.', banned: 'This account is disabled.',
      network: 'Could not reach the server. Check the URL, or set a proxy in Settings for the web version.',
      format: 'The server answered in an unexpected format.', required: 'Please fill in all fields.',
    },
    step: { categories: 'Reading categories', live: 'Reading channels', movies: 'Reading movies', series: 'Reading series', saving: 'Saving', index: 'Building search', m3u: 'Downloading playlist' },
  },
  catalog: {
    categories: 'Categories', allCategories: 'All', manage: 'Manage', doneManaging: 'Done', hide: 'Hide', show: 'Show',
    rename: 'Rename', moveUp: 'Move up', moveDown: 'Move down', reset: 'Reset name', hidden: 'Hidden',
    sort: 'Sort', sortAdded: 'Recently added', sortName: 'Name', sortYear: 'Year', sortRating: 'Rating',
    genre: 'Genre', year: 'Year', rating: 'Rating', older: 'Older', ratingMin: '{{n}}+', empty: 'Nothing here yet',
    noResults: 'No titles match these filters', items: '{{count}} titles', channels: '{{count}} channels', filters: 'Filters', clear: 'Clear',
  },
  details: {
    play: 'Play', trailer: 'Trailer', favorite: 'Favorite', unfavorite: 'Remove favorite', cast: 'Cast',
    similar: 'Similar titles', inLibrary: 'In your playlists', seasons: 'Seasons', episodes: 'Episodes', season: 'Season {{n}}',
    alsoIn: 'Also available in', director: 'Director', notFound: 'This title is no longer in the playlist.',
  },
  search: { placeholder: 'Search movies, series, channels…', empty: 'Type to search across all playlists', none: 'No results for “{{q}}”', building: 'Preparing search…' },
  profiles: {
    who: "Who's watching?", add: 'Add profile', edit: 'Edit profile', name: 'Profile name', pin: 'PIN (optional, 4 digits)',
    enterPin: 'Enter PIN for {{name}}', wrongPin: 'Wrong PIN', removePin: 'Remove PIN', setPin: 'Set PIN', manage: 'Manage profiles', me: 'Me',
  },
  settings: {
    title: 'Settings', language: 'Language', layout: 'Layout', layoutAuto: 'Automatic', layoutTv: 'TV', layoutDesktop: 'Desktop',
    layoutMobile: 'Mobile', proxy: 'Proxy URL (web version)', proxyHint: 'Your Cloudflare Worker address. Leave empty on Android.',
    refresh: 'Update catalog every', hours: '{{count}} hours', playlists: 'Playlists', profiles: 'Profiles', about: 'About',
    version: 'Version', build: 'Build', updateReady: 'A new version is ready', reload: 'Reload',
  },
};

export type Dict = typeof en;
