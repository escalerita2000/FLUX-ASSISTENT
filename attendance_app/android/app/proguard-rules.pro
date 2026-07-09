# Flutter ProGuard Rules
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.embedding.** { *; }
-keep class io.flutter.provider.** { *; }

# Google ML Kit and Barcode Scanning ProGuard Rules
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_barcode.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_common.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_barcode_bundled.** { *; }
-dontwarn com.google.mlkit.**
-dontwarn com.google.android.gms.**

# Keep Mobile Scanner classes
-keep class class.juliansteenbakker.mobile_scanner.** { *; }
-keep class com.juliansteenbakker.mobile_scanner.** { *; }
-dontwarn com.juliansteenbakker.mobile_scanner.**

# Ignore missing Play Core classes referenced by Flutter's deferred components
-dontwarn com.google.android.play.core.**
