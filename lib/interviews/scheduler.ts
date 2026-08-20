import nodemailer from "nodemailer";

export type InterviewProvider = "google" | "teams" | "zoom";
type InterviewRequest = { provider: InterviewProvider; candidateName: string; candidateEmail: string; jobTitle: string; startAt: string };

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload: unknown;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) throw new Error(`Meeting provider returned ${response.status}: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  return payload as T;
}

async function createGoogleMeet(subject: string, start: Date, end: Date) {
  const accessToken = required("GOOGLE_CALENDAR_ACCESS_TOKEN");
  const result = await jsonRequest<{ hangoutLink?: string; conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> } }>(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        summary: subject,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
      }),
    },
  );
  const url = result.hangoutLink || result.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri;
  if (!url) throw new Error("Google Calendar created the event but did not return a Meet link.");
  return url;
}

async function createTeamsMeeting(subject: string, start: Date, end: Date) {
  const accessToken = required("MICROSOFT_GRAPH_ACCESS_TOKEN");
  const result = await jsonRequest<{ onlineMeeting?: { joinUrl?: string }; onlineMeetingUrl?: string }>("https://graph.microsoft.com/v1.0/me/events", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      subject,
      start: { dateTime: start.toISOString().replace(/Z$/, ""), timeZone: "UTC" },
      end: { dateTime: end.toISOString().replace(/Z$/, ""), timeZone: "UTC" },
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
    }),
  });
  const url = result.onlineMeeting?.joinUrl || result.onlineMeetingUrl;
  if (!url) throw new Error("Microsoft Graph created the event but did not return a Teams link.");
  return url;
}

async function createZoomMeeting(subject: string, start: Date) {
  const accountId = required("ZOOM_ACCOUNT_ID");
  const clientId = required("ZOOM_CLIENT_ID");
  const clientSecret = required("ZOOM_CLIENT_SECRET");
  const userId = required("ZOOM_USER_ID");
  const token = await jsonRequest<{ access_token: string }>(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
  });
  const meeting = await jsonRequest<{ join_url?: string }>(`https://api.zoom.us/v2/users/${encodeURIComponent(userId)}/meetings`, {
    method: "POST",
    headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ topic: subject, type: 2, start_time: start.toISOString(), duration: 30, timezone: "UTC", settings: { waiting_room: true } }),
  });
  if (!meeting.join_url) throw new Error("Zoom created the meeting but did not return a join link.");
  return meeting.join_url;
}

function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character); }

async function sendInvitation(input: InterviewRequest, subject: string, meetingUrl: string, start: Date) {
  const port = Number(required("SMTP_PORT"));
  const transporter = nodemailer.createTransport({
    host: required("SMTP_HOST"), port, secure: port === 465,
    auth: { user: required("SMTP_USER"), pass: required("SMTP_PASSWORD") },
  });
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(start);
  await transporter.sendMail({
    from: required("SMTP_FROM"), to: input.candidateEmail, subject,
    text: `Hello ${input.candidateName},\n\nYour interview for ${input.jobTitle} is scheduled for ${when}.\n\nJoin meeting: ${meetingUrl}\n`,
    html: `<p>Hello ${escapeHtml(input.candidateName)},</p><p>Your interview for <strong>${escapeHtml(input.jobTitle)}</strong> is scheduled for ${escapeHtml(when)}.</p><p><a href="${escapeHtml(meetingUrl)}">Join the interview meeting</a></p>`,
  });
}

export async function scheduleInterview(input: InterviewRequest) {
  const start = new Date(input.startAt);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const subject = `Interview: ${input.jobTitle} — ${input.candidateName}`;
  const meetingUrl = input.provider === "google"
    ? await createGoogleMeet(subject, start, end)
    : input.provider === "teams"
      ? await createTeamsMeeting(subject, start, end)
      : await createZoomMeeting(subject, start);
  await sendInvitation(input, subject, meetingUrl, start);
  return { meetingUrl, startAt: start.toISOString(), provider: input.provider, emailSent: true };
}
