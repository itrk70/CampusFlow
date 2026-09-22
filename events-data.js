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

   AUTO-EXPIRY: an event quietly drops off the Events page on its
   own 10 days after its end date/time — you don't need to come
   back and delete old entries yourself. It still physically stays
   in this file until you remove it; the app just stops showing it.
   ========================================================= */

window.CAMPUSFLOW_EVENTS = [
   {
      name: "THE INNER FIGHT: From Fear to Confidence",
      date: "2026-09-19",
      startTime: "14:00",
      endTime: "16:00",
      venue: "UB-II, Auditorium",
      description: "Mononiketan – Mental Health & Wellness Centre, Brainware University, is pleased to organize “THE INNER FIGHT: From Fear to Confidence,” an experiential programme focusing on suicide prevention, emotional resilience, self-confidence, and mental well-being. ",
      image: null,
   },
   {
      name: "Photography Competetion-Cum-Exhibition",
      date: "2026-10-01",
      startTime: "11:00",
      endTime: null,
      venue: "UB-II, 007",
      description: "Mononiketan – Mental Health & Wellness Centre, Brainware University, is pleased to organize “THE INNER FIGHT: From Fear to Confidence,” an experiential programme focusing on suicide prevention, emotional resilience, self-confidence, and mental well-being. ",
      image: "assets/photography-competetion-2026.jpeg",
   },
   {
      name: "Arduino Edge AI Hackathon",
      date: "2026-10-06",
      startTime: "00:00",
      endTime: null,
      venue: "UB-II, Auditorium",
      description: "The AI & Tech Club, IEEE Student Branch – Brainware University, in association with the Department of Computer Science & Engineering (CSE) and Institution’s Innovation Council (IIC), Brainware University, in collaboration with StemLore, is organizing the Arduino Edge AI Hackathon 2026 – Build, Innovate & Deploy as part of the IEEE Day Celebration 2026.",
      image: null,
   },
];
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
