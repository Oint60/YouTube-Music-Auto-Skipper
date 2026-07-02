# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in C:\Users\Mudai\AppData\Local\Android\Sdk/tools/proguard/proguard-android.txt
# You can edit the include path and place your own rules here.

-keepattributes Signature, InnerClasses, EnclosingMethod

# Gson rules
-keep class com.google.gson.reflect.TypeToken { *; }
-keep class * implements com.google.gson.TypeAdapterFactory
-keep class * implements com.google.gson.JsonSerializer
-keep class * implements com.google.gson.JsonDeserializer

# Keep your model classes if any
-keep class com.mudai.ytm_listener.** { *; }
