import 'package:shared_preferences/shared_preferences.dart';

/// App-wide configuration.
class AppConfig {
  /// Compile-time default, used until someone overrides it in the app.
  ///
  /// On a physical phone over USB this stays `localhost` because of
  /// `adb reverse tcp:4000 tcp:4000` - the cable tunnels the phone's port 4000
  /// to the PC's.
  ///
  /// Override at build time when needed:
  ///   flutter run --dart-define=API_BASE_URL=http://192.168.1.5:4000
  static const String _compiledDefault = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:4000',
  );

  static const _prefsKey = 'zonal.serverUrl';

  /// The address actually in use. Held in memory so every request reads it
  /// without touching disk.
  static String _baseUrl = _compiledDefault;

  static String get baseUrl => _baseUrl;
  static String get apiUrl => '$_baseUrl/api';
  static String get compiledDefault => _compiledDefault;
  static bool get isOverridden => _baseUrl != _compiledDefault;

  /// Load any saved override. Called once at startup.
  ///
  /// This exists because a laptop's WiFi address changes - moving between
  /// networks, or the router simply handing out a different one. Baking the
  /// address in at build time means a rebuild every time that happens, which
  /// is no use to someone standing in front of an audience.
  static Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_prefsKey);
      if (saved != null && saved.trim().isNotEmpty) _baseUrl = saved.trim();
    } catch (_) {
      // Fall back to the compiled default - never block startup on this.
    }
  }

  /// Point the app at a different server. Returns the normalised URL.
  static Future<String> setBaseUrl(String raw) async {
    var url = raw.trim();
    if (url.isEmpty) return _baseUrl;

    // Accept "172.16.3.36" or "172.16.3.36:4000" as well as a full URL.
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://$url';
    }
    if (!RegExp(r':\d+$').hasMatch(url)) url = '$url:4000';
    url = url.replaceAll(RegExp(r'/+$'), '');

    _baseUrl = url;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsKey, url);
    return url;
  }

  static Future<void> resetBaseUrl() async {
    _baseUrl = _compiledDefault;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_prefsKey);
  }

  /// Resolves a relative media path returned by the API into a full URL.
  static String mediaUrl(String path) {
    if (path.startsWith('http')) return path;
    return '$_baseUrl$path';
  }

  // Capture limits - must mirror the caps enforced by the backend.
  static const int maxVideoSeconds = 30;
  static const int maxAudioSeconds = 60;
  static const int maxAttachments = 5;

  /// GPS fixes worse than this are rejected, so a complaint can never be
  /// filed against a location we are not reasonably confident about.
  static const double maxAcceptableAccuracyM = 100;
}
