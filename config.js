// Rapid Squares settings.
//
// Aerial imagery uses Azure Maps; address suggestions use Google Places. Paste your Azure Maps
// subscription key below (Azure portal › your Azure Maps account ›
// Settings › Authentication › Primary Key).
//
// Anything in this file is visible to anyone who opens the site, so before
// sharing it publicly, limit the key's allowed origins in the Azure portal
// (Settings › CORS) or switch to Microsoft Entra ID / SAS token auth.
window.RS_CONFIG = {
  azureMapsKey: '',
  // Google Places API (New) key for address suggestions (on the real server: GOOGLE_MAPS_KEY).
  googleMapsKey: '',

  // Country to search in (ISO 3166-1 alpha-2). 'US' limits suggestions and lookups to the
  // United States; any other code searches worldwide with that country preferred in suggestions.
  countryRegion: 'US',

  // How close the aerial view zooms in on a property (higher = closer, max ~20).
  propertyZoom: 19,

  // Address of the Rapid Squares backend (e.g. 'https://api.rapidsquares.com').
  // Leave empty to run on sample data saved in this browser.
  apiBaseUrl: ''
};
