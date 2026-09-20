/* =========================================================
   CampusFlow — Events data file
   -----------------------------------------------------------
   Edit this file to publish events. Everyone who opens the app
   sees the same list — this is NOT stored in localStorage.
   Just add an object to the CAMPUSFLOW_EVENTS array below,
   following the sample structure in the comment.

   FIELD GUIDE:
   - name          (required) Event name, shown as the title.
   - date          (required) "YYYY-MM-DD" — the event's date.
   - startTime     (required) "HH:MM" 24-hour, e.g. "17:30".
   - endTime       (optional) "HH:MM" 24-hour. Leave it out (or
                   set to null) if the event has no fixed end —
                   it will be treated as ending at 00:00:00
                   (midnight) that night.
   - venue         (required) Where it's happening.
   - description   (required) A short paragraph about the event.
   - image         (optional) A URL to a banner image. Leave it
                   out (or null) to show no banner.

   STATUS (computed automatically — you don't set this):
   - "Upcoming"  → before the event starts
   - "Ongoing"   → between start and end time, on the day
   - "Closed"    → after the event's end time has passed
   ========================================================= */

const CAMPUSFLOW_EVENTS = [
  {
    name: "THE INNER FIGHT: From Fear to Confidence",
    date: "2026-09-19",
    startTime: "14:00",
    endTime: "16:00",
    venue: "UB-II, Auditorium",
    description: "A full day of project showcases, guest talks, and workshops from student clubs across departments. Open to all years — drop by any time.",
    image: "https://example.com/path-to-a-banner-image.jpg"
  }
  // ---- SAMPLE EVENT (commented out — copy this shape) ----
  // {
  //   name: "Annual Tech Fest — Innovate 2026",
  //   date: "2026-11-14",
  //   startTime: "10:00",
  //   endTime: "18:00",
  //   venue: "Main Auditorium, UB-VI",
  //   description: "A full day of project showcases, guest talks, and workshops from student clubs across departments. Open to all years — drop by any time.",
  //   image: "https://example.com/path-to-a-banner-image.jpg"
  // },

];
