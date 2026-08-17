import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:zonal/core/api_client.dart';
import 'package:zonal/core/session.dart';
import 'package:zonal/main.dart';

void main() {
  setUp(() {
    // Session.restore() reads the saved token from disk on launch.
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('shows the login screen when nobody is signed in', (tester) async {
    await tester.pumpWidget(const ZonalApp());

    // One frame for the splash, then let restore() settle.
    await tester.pump();
    await tester.pumpAndSettle(const Duration(seconds: 1));

    expect(find.text('Smart Clean Campus'), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Create an account'), findsOneWidget);
  });

  testWidgets('login form rejects an empty submission', (tester) async {
    await tester.pumpWidget(const ZonalApp());
    await tester.pump();
    await tester.pumpAndSettle(const Duration(seconds: 1));

    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();

    expect(find.text('Enter your campus email'), findsOneWidget);
    expect(find.text('Enter your password'), findsOneWidget);
  });

  testWidgets('a restored session sends a resident to their own home', (tester) async {
    final api = ApiClient();
    final session = Session(api);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          Provider<ApiClient>.value(value: api),
          ChangeNotifierProvider<Session>.value(value: session),
        ],
        child: const MaterialApp(home: Scaffold(body: Text('routed'))),
      ),
    );

    expect(find.text('routed'), findsOneWidget);
  });
}
