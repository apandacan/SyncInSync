InSync Roles Sync, v6

New in v6:
- shared roles are moved into the patient assignment board
- patient rows on the left
- role columns across the top
- interviewer has no tag in the generated note line
- randomize button for each patient row
- randomize entire schedule button
- selected patient dropdown drives the generated student line and HPI updater

How to run:
1. Replace your old files with this version, or unzip into a new folder.
2. Open a terminal in the folder.
3. Run:
   node server.js
4. Open:
   http://localhost:3000

Notes:
- names and patient role assignments are shared and persisted on the server
- pasted HPI stays local in each browser
- only non-PHI should go into the shared board
- randomize entire schedule now balances role coverage so each student gets each role before repeats whenever patient count allows
- row-level randomize now prefers students who are underrepresented in each role across the rest of the schedule

- each person can now have a custom displayed role title, like Medical Student or Premedical Student
- generated student line now groups people by matching role title text

- generated student line now uses the exact entered role title text with no pluralization

- clicking a patient row selects it for the HPI tool
- added red X button per patient row to mark encounter ended with shared gray/strikethrough styling

- added first-visit popup asking for your name and role title, defaulting to Medical Student
- once you identify yourself, green person buttons let you sign yourself up for any role with one click
- clicking the green person again removes you from that role
- ended encounters are now darker gray and no longer selectable for the HPI tool

- front end is now split into public/index.html, public/styles.css, and public/app.js for easier editing

- added Student Guide PDF viewer button, expecting the PDF at public/student-guide.pdf
- added blue MSE Guide PDF viewer button, expecting the PDF at public/mse-guide.pdf
- added Clear board button that removes all patient rows and resets ended states without removing students

- added orange 4P's Guide PDF viewer button, expecting the PDF at public/4ps-guide.pdf
- removed Copy updated HPI button from the top bar

- made the PDF guide window larger and added zoom in, zoom out, and reset controls
