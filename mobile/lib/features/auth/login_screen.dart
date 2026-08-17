import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/palette.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import 'register_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();

  bool _busy = false;
  bool _obscure = true;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      await context.read<Session>().login(_email.text.trim(), _password.text);
      // The role router takes over from here.
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const _Wordmark(),
                    const SizedBox(height: 36),

                    TextFormField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                        labelText: 'Email',
                        prefixIcon: Icon(Icons.alternate_email),
                      ),
                      validator: (v) => (v == null || !v.contains('@'))
                          ? 'Enter your campus email'
                          : null,
                    ),
                    const SizedBox(height: 14),

                    TextFormField(
                      controller: _password,
                      obscureText: _obscure,
                      autofillHints: const [AutofillHints.password],
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _submit(),
                      decoration: InputDecoration(
                        labelText: 'Password',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
                          tooltip: _obscure ? 'Show password' : 'Hide password',
                          onPressed: () => setState(() => _obscure = !_obscure),
                        ),
                      ),
                      validator: (v) =>
                          (v == null || v.isEmpty) ? 'Enter your password' : null,
                    ),

                    if (_error != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Palette.critical.withValues(alpha: 0.08),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: Palette.critical.withValues(alpha: 0.3)),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(Icons.error_outline,
                                color: Palette.critical, size: 19),
                            const SizedBox(width: 9),
                            Expanded(
                              child: Text(
                                _error!,
                                style: const TextStyle(
                                    color: Palette.critical, height: 1.35, fontSize: 13.5),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    const SizedBox(height: 22),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      child: _busy
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2.2, color: Colors.white),
                            )
                          : const Text('Sign in'),
                    ),
                    const SizedBox(height: 10),
                    TextButton(
                      onPressed: _busy
                          ? null
                          : () => Navigator.of(context).push(
                                MaterialPageRoute(builder: (_) => const RegisterScreen()),
                              ),
                      child: const Text('Create an account'),
                    ),
                    const SizedBox(height: 18),
                    _ServerAddress(
                      onChanged: () => setState(() {}),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Which server the app is talking to, and a way to change it.
///
/// A laptop's WiFi address changes when it moves between networks, and baking
/// it in at build time means a rebuild every time that happens - useless when
/// you are standing in front of an audience. This puts it one tap away.
class _ServerAddress extends StatelessWidget {
  final VoidCallback onChanged;

  const _ServerAddress({required this.onChanged});

  Future<void> _edit(BuildContext context) async {
    final controller = TextEditingController(text: AppConfig.baseUrl);

    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Server address'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Where the app should reach the backend. Use your PC\'s WiFi '
              'address, or localhost when connected by USB cable.',
              style: TextStyle(fontSize: 13, height: 1.4, color: Palette.inkSecondary),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: controller,
              autofocus: true,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                hintText: '172.16.3.36',
                helperText: 'Port 4000 is added if you leave it out',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop('__reset__'),
            child: const Text('Reset'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(controller.text),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (result == null) return;
    if (result == '__reset__') {
      await AppConfig.resetBaseUrl();
    } else {
      await AppConfig.setBaseUrl(result);
    }
    onChanged();
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: TextButton.icon(
        onPressed: () => _edit(context),
        icon: const Icon(Icons.dns_outlined, size: 15, color: Palette.inkMuted),
        label: Text(
          AppConfig.baseUrl.replaceFirst('http://', ''),
          style: const TextStyle(fontSize: 11.5, color: Palette.inkMuted),
        ),
      ),
    );
  }
}

/// The eight-zone ring, drawn small. The same shape that organises the whole
/// system, used here as the mark.
class _Wordmark extends StatelessWidget {
  const _Wordmark();

  static const _layout = [
    [2, 1, 8],
    [3, null, 7],
    [4, 5, 6],
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SizedBox(
          width: 76,
          height: 76,
          child: Column(
            children: [
              for (final row in _layout)
                Expanded(
                  child: Row(
                    children: [
                      for (final code in row)
                        Expanded(
                          child: Container(
                            margin: const EdgeInsets.all(1.6),
                            decoration: BoxDecoration(
                              color: code == null
                                  ? const Color(0xFFEFF4EC)
                                  : Palette.zoneRing[code],
                              borderRadius: BorderRadius.circular(3.5),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        const Text(
          'Smart Clean Campus',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 25,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.6,
            color: AppTheme.seed,
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'EIGHT ZONES  ·  ONE CAMPUS',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 10.5,
            letterSpacing: 2.4,
            fontWeight: FontWeight.w700,
            color: Palette.inkMuted,
          ),
        ),
      ],
    );
  }
}
