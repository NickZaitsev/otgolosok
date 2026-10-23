package online.otgolosok.app

import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    // The engine belongs to the Application and outlives this activity (see OtgolosokApplication).
    override fun getCachedEngineId(): String = OtgolosokApplication.ENGINE_ID

    override fun shouldDestroyEngineWithHost(): Boolean = false
}
