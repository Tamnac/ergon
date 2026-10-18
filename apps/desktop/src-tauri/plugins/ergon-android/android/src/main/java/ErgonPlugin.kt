package app.ergon.plugin

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import androidx.core.app.NotificationManagerCompat
import app.tauri.PermissionState
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class KeyArgs {
  lateinit var key: String
}

@InvokeArg
class SecretArgs {
  lateinit var key: String
  var value: String? = null
}

@InvokeArg
class ReminderArg {
  lateinit var id: String
  var at: Long = 0
  lateinit var text: String
}

@InvokeArg
class RemindersArgs {
  var reminders: Array<ReminderArg> = arrayOf()
}

private const val NOTIFICATIONS = "notifications"
private const val KEYSTORE = "AndroidKeyStore"
private const val KEY_ALIAS = "ergon-secrets"
private const val PREFERENCES = "ergon-secrets"
private const val IV_BYTES = 12
private const val TAG_BITS = 128

@TauriPlugin(
  permissions = [
    Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = NOTIFICATIONS),
  ],
)
class ErgonPlugin(private val activity: Activity) : Plugin(activity) {
  private val preferences by lazy {
    activity.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
  }

  @Command
  fun secretGet(invoke: Invoke) {
    val args = invoke.parseArgs(KeyArgs::class.java)
    val stored = preferences.getString(args.key, null)
    val result = JSObject()
    // A value that can't be decrypted, e.g. after a restore without the Keystore key, counts as missing.
    result.put("value", stored?.let { runCatching { decrypt(it) }.getOrNull() })
    invoke.resolve(result)
  }

  @Command
  fun secretSet(invoke: Invoke) {
    val args = invoke.parseArgs(SecretArgs::class.java)
    val value = args.value
    val editor = preferences.edit()
    if (value == null) editor.remove(args.key) else editor.putString(args.key, encrypt(value))
    editor.apply()
    invoke.resolve()
  }

  /** Asks for the permission to show notifications, if the system requires one. */
  @Command
  fun allowNotifications(invoke: Invoke) {
    val needsAsking = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      getPermissionState(NOTIFICATIONS) != PermissionState.GRANTED
    if (needsAsking) requestPermissionForAlias(NOTIFICATIONS, invoke, "notificationsAnswered")
    else resolveNotifications(invoke)
  }

  @PermissionCallback
  private fun notificationsAnswered(invoke: Invoke) = resolveNotifications(invoke)

  private fun resolveNotifications(invoke: Invoke) {
    val result = JSObject()
    result.put("allowed", NotificationManagerCompat.from(activity).areNotificationsEnabled())
    invoke.resolve(result)
  }

  @Command
  fun setReminders(invoke: Invoke) {
    val args = invoke.parseArgs(RemindersArgs::class.java)
    Reminders.replace(activity, args.reminders.map { Due(it.id, it.at, it.text) })
    invoke.resolve()
  }

  @Command
  fun exactAlarmsAllowed(invoke: Invoke) {
    val alarms = activity.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val result = JSObject()
    result.put("allowed", Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms())
    invoke.resolve(result)
  }

  @Command
  fun openExactAlarmSettings(invoke: Invoke) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${activity.packageName}"))
      activity.startActivity(intent)
    }
    invoke.resolve()
  }

  private fun secretKey(): SecretKey {
    val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val spec = KeyGenParameterSpec.Builder(
      KEY_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .build()
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
      .apply { init(spec) }
      .generateKey()
  }

  /** The IV followed by the ciphertext, Base64 encoded. */
  private fun encrypt(plain: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    val sealed = cipher.iv + cipher.doFinal(plain.toByteArray())
    return Base64.encodeToString(sealed, Base64.NO_WRAP)
  }

  private fun decrypt(stored: String): String {
    val sealed = Base64.decode(stored, Base64.NO_WRAP)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, sealed, 0, IV_BYTES))
    return String(cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES))
  }
}
