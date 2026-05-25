// src/tools/tool-instructions.js
export const TOOL_INSTRUCTIONS = {
  forms: `
    <p>Här kan du fylla i formulär kopplade till en specifik plats på kartan.</p>
    <p>Börja med att välja formulär om flera finns att välja på, klicka därefter på 'Aktivera klickläge' och sedan på kartan för att koppla dina svar till den platsen.</p>
    <p>Fyll i formuläret och klicka sedan på 'Submit' för att spara dina svar till vår databas.</p>
    <p>Formulärsläget stängs av genom att klicka på 'Inaktivera klickläge' eller att kryssa hela verktygsrutan.</p>
    `,
  measure: `
    <p>Välj mätläge genom att klicka på Area-, Distans- eller Höjd fliken. Där efter klicka på pennan i:
    <p>Arealäget: Klicka minst 3 gånger och dubbelklicka för att färdigställa måttet.</p>
    <p>Distansläget: Klicka för att lägga ut punkter och dubbelklicka för att färdigställa måttet.</p>
    <p>Höjdläget: Klicka på en startpunkt och en slutpunkt för att mäta höjdskillnaden.</p>
    <p>Efter färdigställt mått kan man klicka ut ett nytt mått direkt. Mätningen stängs av genom att klicka på pennan med ett streck över, byta mätflik eller kryssa hela verktygsrutan.</p>
    <p>Det går att ångra utsatta punkter innan färdigställt mått genom att klicka på "esc" på tangentbordet.</p>
  `,
  placement: `
    <h3>Placera objekt</h3>
    <p>Välj modell och klicka i kartan för att placera.</p>
  `,
  bookmarks: `
    <p>Klicka på ett bokmärke för att zooma till det området.</p>
  `,
  "draw-3d": `
  <p>Ange önskad höjd och klicka på pennan för att sedan klicka i kartan och placera ut punkter.</p>
  <p>Minst 3 punkter krävs för att skapa en 3D-polygon. Färdigställ objektet genom att dubbelklicka den sista punkten.</p>
  <p>Det går att ångra utsatta punkter innan färdigställt objekt genom att klicka på "esc" på tangentbordet.</p>
  <p>Efter färdigställt objekt kan man rita ut ett nytt objekt direkt.</p>
  <p>Ritläget stängs av genom att klicka på pennan med ett streck över eller att kryssa hela verktygsrutan.</p>
  `,
  "sun-study": `
  <p>Aktivera skuggor i modellen genom att klicka på "Switchen" eller dra i ett av reglagen för månad, datum eller tid.</p>
  <p>Startklockslag är lokalt klockslag på din maskin (pc eller mobil).</p>
  <p>Skuggor kastas även av objekt placerade genom "Placera" verktyget och av 3D-objekt ritade genom "Rita 3D" verktyget.</p>
  <p> OBS: Skuggor kan bara stängas av genom att klicka på "Switchen".</p>
  `,
  "hide-buildings" : `
  <p>Genom att mittenklicka (mus-skrollen) på byggnader så göms de temporärt. För att återställa gömda byggnader klicka på "Ögat".</p>
  <p>Det går inte att gömma objekt man själv placerat ut. </p>
  `,
  "pedestrian-mode": `
  <p>Aktivera fotgängarläge genom att zooma in och klicka på marken där du vill placera dig.</p>
  <p>Det går att ändra önskad ögonhöjd.</p>
  <p>För att rotera kameran, klicka eller håll in pilarna. </p>
  <p>För att förflytta dig, klicka på önskad ny posistion på marken. </p>
  <p>På pc går det även att rotera kameran genom att hålla inne "Shift" och klicka och dra med musen.</p>
  `,
  "terrain-section": `
  <p>1. Välj metod för punktplacering <br> 
  2. Specificera antal punkter eller punktmellanrum <br>
  3. Tryck Aktivera och placera ut två punkter <br>
  4. Har flera grafer ritats kan man välja graf att visa under Graf-index <br> 
  5. Grafer går att radera <br>
  6. Vid export, exporteras vald graf i Graf-index <br><br>
  Noggrannheten beror på terrängens detaljnivå, kamerans zoom och att terrängen hunnit laddas färdigt innan mätning.
  </p>
  `
};

// fallback if help text is not configured
export const DEFAULT_INSTRUCTION = `
  <h3>Hjälp</h3>
  <p>Ingen hjälptext är definierad för detta verktyg.</p>
`;