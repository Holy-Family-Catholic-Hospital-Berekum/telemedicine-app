/**
 * doctors.js
 * Put this at: src/data/doctors.js
 *
 * IMAGES — read this before adding yours
 * --------------------------------------
 * The `image` field is a plain URL string, not an import, so a missing file
 * will NOT break your build. Drop the photos into your `public` folder:
 *
 *   public/doctors/dr-mensah.jpg
 *   public/doctors/dr-asante.jpg
 *   ...and so on, matching the paths below.
 *
 * Portrait crops work best (roughly 3:4). Until a file exists at that path the
 * card falls back to the doctor's initials on a soft forest/gold tile, so the
 * slider looks intentional rather than broken while you're still collecting
 * photos.
 *
 * If you'd rather bundle the images through Vite instead of `public/`, swap to
 * imports:
 *
 *   import drMensah from "../assets/doctors/dr-mensah.jpg";
 *   ...
 *   { ..., image: drMensah }
 *
 * Everything else about the component stays the same.
 */

import doc1 from "../../images/doctors/doc1.jpg";
import doc2 from "../../images/doctors/doc2.jpg";
import doc3 from "../../images/doctors/doc3.jpg";
import doc4 from "../../images/doctors/doc4.jpg";

const doctors = [
  {
    id: "mensah",
    name: "Dr. Kwabena Mensah",
    role: "General OPD",
    focus:
      "Everyday illness, hypertension and diabetes reviews, and family follow-ups.",
    availability: "Online or in person",
    image: doc1,
    initials: "KM",
  },
  {
    id: "asante",
    name: "Dr. Efua Asante",
    role: "General OPD",
    focus: "Women's health, antenatal advice, and child check-ups.",
    availability: "Online or in person",
    image: doc2,
    initials: "EA",
  },
  {
    id: "adjei",
    name: "Dr. Samuel Adjei",
    role: "Surgical consultation",
    focus: "Pre-surgery assessment and post-operation wound reviews.",
    availability: "Online or in person",
    image: doc3,
    initials: "SA",
  },
  {
    id: "owusu",
    name: "Dr. Naa Owusu",
    role: "General OPD",
    focus: "Malaria, typhoid, respiratory infections, and lab result reviews.",
    availability: "Online",
    image: doc4,
    initials: "NO",
  },
];

export default doctors;
