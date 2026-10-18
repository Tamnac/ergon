package app.ergon.plugin

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject

private const val CHANNEL = "reminders"
private const val STORE = "ergon-reminders"
private const val STORED = "reminders"
private const val ALARM_ID = "alarmId"
private const val TEXT = "text"

/** Reminders that came due longer ago than this are dropped instead of shown late. */
private const val GRACE_MS = 60 * 60 * 1000L

/** A reminder due at `at`, in Unix milliseconds. */
data class Due(val id: String, val at: Long, val text: String) {
  /** Changes with whatever the notification shows, so an edited reminder gets a new alarm. */
  val alarmId: Int get() = "$id|$at|$text".hashCode()
}

/**
 * Reminders as exact alarms. The system fires them while the app is closed; the ones still
 * to come are kept in preferences to schedule them again after a reboot.
 */
object Reminders {
  /** Makes the alarms match `next`: alarms of reminders that are gone or changed are cancelled. */
  fun replace(context: Context, next: List<Due>) {
    val upcoming = next.filter { it.at > System.currentTimeMillis() }
    val wanted = upcoming.map { it.alarmId }.toSet()
    val stored = load(context)
    val known = stored.map { it.alarmId }.toSet()
    stored.filter { it.alarmId !in wanted }.forEach { cancel(context, it) }
    upcoming.filter { it.alarmId !in known }.forEach { schedule(context, it) }
    save(context, upcoming)
  }

  /** Schedules the stored reminders again, and shows the ones that came due while the device was off. */
  fun restore(context: Context) {
    val now = System.currentTimeMillis()
    for (due in load(context)) {
      if (due.at > now) schedule(context, due)
      else if (now - due.at <= GRACE_MS) show(context, due.alarmId, due.text)
    }
    save(context, load(context).filter { it.at > now })
  }

  fun fire(context: Context, alarmId: Int, text: String) {
    save(context, load(context).filter { it.alarmId != alarmId })
    show(context, alarmId, text)
  }

  private fun schedule(context: Context, due: Due) {
    val alarms = context.getSystemService(AlarmManager::class.java)
    val operation = operation(context, due.alarmId, due.text)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()) {
      alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, due.at, operation)
    } else {
      alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, due.at, operation)
    }
  }

  private fun cancel(context: Context, due: Due) {
    context.getSystemService(AlarmManager::class.java).cancel(operation(context, due.alarmId, due.text))
    NotificationManagerCompat.from(context).cancel(due.alarmId)
  }

  private fun operation(context: Context, alarmId: Int, text: String): PendingIntent {
    val intent = Intent(context, ReminderReceiver::class.java)
      .putExtra(ALARM_ID, alarmId)
      .putExtra(TEXT, text)
    return PendingIntent.getBroadcast(
      context,
      alarmId,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  @SuppressLint("MissingPermission")
  private fun show(context: Context, alarmId: Int, text: String) {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH)
      manager.createNotificationChannel(channel)
    }
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val content = PendingIntent.getActivity(
      context,
      alarmId,
      open,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(text)
      .setContentText("Ergon")
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(content)
      .setAutoCancel(true)
      .build()
    manager.notify(alarmId, notification)
  }

  private fun preferences(context: Context) =
    context.getSharedPreferences(STORE, Context.MODE_PRIVATE)

  private fun load(context: Context): List<Due> {
    val json = JSONArray(preferences(context).getString(STORED, "[]"))
    return (0 until json.length()).map {
      val item = json.getJSONObject(it)
      Due(item.getString("id"), item.getLong("at"), item.getString("text"))
    }
  }

  private fun save(context: Context, reminders: List<Due>) {
    val json = JSONArray(
      reminders.map { JSONObject().put("id", it.id).put("at", it.at).put("text", it.text) },
    )
    preferences(context).edit().putString(STORED, json.toString()).apply()
  }
}

class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val text = intent.getStringExtra(TEXT) ?: return
    Reminders.fire(context, intent.getIntExtra(ALARM_ID, 0), text)
  }
}

/** After a reboot or an update, and when the exact alarm permission changes, alarms are gone. */
class RestoreReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    Reminders.restore(context)
  }
}
