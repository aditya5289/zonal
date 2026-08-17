import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api_client.dart';
import '../core/config.dart';
import '../core/palette.dart';

/// Loads complaint media from the API.
///
/// Uploaded photos are behind authentication - they are pictures of named
/// people's complaints, at a known place and time, and were previously
/// readable by anyone holding the URL. `Image.network` sends no auth header of
/// its own, so every image in the app goes through here to attach the token.
class AuthedImage extends StatelessWidget {
  final String path;
  final double? width;
  final double? height;
  final BoxFit fit;
  final BorderRadius? borderRadius;

  const AuthedImage({
    super.key,
    required this.path,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.borderRadius,
  });

  @override
  Widget build(BuildContext context) {
    final token = context.read<ApiClient>().token;

    final image = Image.network(
      AppConfig.mediaUrl(path),
      width: width,
      height: height,
      fit: fit,
      headers: token != null ? {'Authorization': 'Bearer $token'} : null,
      loadingBuilder: (context, child, progress) {
        if (progress == null) return child;
        return Container(
          width: width,
          height: height,
          color: const Color(0xFFEDF0F3),
          child: const Center(
            child: SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          ),
        );
      },
      errorBuilder: (_, __, ___) => Container(
        width: width,
        height: height,
        color: const Color(0xFFEDF0F3),
        child: const Center(
          child: Icon(
            Icons.image_not_supported_outlined,
            size: 20,
            color: Palette.inkMuted,
          ),
        ),
      ),
    );

    if (borderRadius == null) return image;
    return ClipRRect(borderRadius: borderRadius!, child: image);
  }
}
