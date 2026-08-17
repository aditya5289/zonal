import 'package:geolocator/geolocator.dart';

/// Result of asking the device where it is.
class GeoFix {
  final double lat;
  final double lng;
  final double accuracyM;
  final DateTime at;

  const GeoFix({
    required this.lat,
    required this.lng,
    required this.accuracyM,
    required this.at,
  });
}

class LocationDenied implements Exception {
  final String message;
  final bool permanentlyDenied;
  const LocationDenied(this.message, {this.permanentlyDenied = false});

  @override
  String toString() => message;
}

/// Acquires the GPS fix that every complaint is required to carry.
///
/// The compulsory-geotag rule from the project spec is enforced in two places:
/// here (the Submit button stays disabled until this succeeds) and again on the
/// server, which rejects any complaint without a valid lat/lng.
class LocationService {
  static Future<GeoFix> current() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const LocationDenied(
        'Location is switched off. Turn on GPS to file a complaint.',
      );
    }

    var permission = await Geolocator.checkPermission();

    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }

    if (permission == LocationPermission.deniedForever) {
      throw const LocationDenied(
        'Location permission is permanently denied. Enable it for this app in '
        'Settings to file a complaint.',
        permanentlyDenied: true,
      );
    }

    if (permission == LocationPermission.denied) {
      throw const LocationDenied(
        'A complaint cannot be filed without its location.',
      );
    }

    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 20),
      ),
    );

    return GeoFix(
      lat: position.latitude,
      lng: position.longitude,
      accuracyM: position.accuracy,
      at: position.timestamp,
    );
  }

  static Future<void> openSettings() => Geolocator.openAppSettings();
}
