import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing: android/key.properties (gitignored) or the same environment variables as the
// Capacitor app (docs/agents/mobile-app.md, «Подпись релиза»). One upload key signs both.
val keyProperties = Properties().apply {
    val file = rootProject.file("key.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

fun signingValue(property: String, variable: String): String? =
    keyProperties.getProperty(property)?.takeIf { it.isNotBlank() }
        ?: System.getenv(variable)?.takeIf { it.isNotBlank() }

val releaseStoreFile = signingValue("storeFile", "OTGOLOSOK_KEYSTORE_FILE")
val releaseStorePassword = signingValue("storePassword", "OTGOLOSOK_KEYSTORE_PASSWORD")
val releaseKeyAlias = signingValue("keyAlias", "OTGOLOSOK_KEY_ALIAS")
val releaseKeyPassword = signingValue("keyPassword", "OTGOLOSOK_KEY_PASSWORD")
val releaseSigningReady = listOf(releaseStoreFile, releaseStorePassword, releaseKeyAlias, releaseKeyPassword).all { it != null }

android {
    buildFeatures {
        resValues = true
    }

    namespace = "online.otgolosok.app"
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Same id as the Capacitor app: a store release of this app replaces it (plan, decision 3).
        applicationId = "online.otgolosok.app"
        minSdk = 26
        targetSdk = 36
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        resValue("string", "app_name", "Отголосок")
    }

    signingConfigs {
        if (releaseSigningReady) {
            create("release") {
                storeFile = rootProject.file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            // Installs next to the Capacitor app and the store build.
            applicationIdSuffix = ".dev"
            resValue("string", "app_name", "Отголосок (dev)")
        }
        release {
            signingConfig = if (releaseSigningReady) signingConfigs.getByName("release") else null
        }
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

// An unsigned release must never be produced by accident.
gradle.taskGraph.whenReady {
    val releaseTask = allTasks.any { task ->
        task.project == project && Regex("^(assemble|bundle|package)Release$").matches(task.name)
    }
    if (releaseTask && !releaseSigningReady) {
        throw GradleException(
            "Нет ключа подписи релиза. Заполните mobile-flutter/android/key.properties " +
                "(storeFile, storePassword, keyAlias, keyPassword) или задайте OTGOLOSOK_KEYSTORE_FILE, " +
                "OTGOLOSOK_KEYSTORE_PASSWORD, OTGOLOSOK_KEY_ALIAS, OTGOLOSOK_KEY_PASSWORD. См. docs/agents/mobile-flutter.md.",
        )
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
