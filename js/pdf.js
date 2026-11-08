/* ============================================================
   Omni-Cooking — générateur PDF minimal, en JavaScript vanilla
   et 100 % hors ligne (aucune bibliothèque externe).

   Produit un PDF 1.4 valide : pages A4, polices de base
   Helvetica / Helvetica-Bold, encodage WinAnsiEncoding (cp1252),
   donc compatible avec les accents français (é, è, à, ç, œ, €…).
   ============================================================ */
'use strict';

const OmniPDF = (() => {

  /* Table cp1252 pour les caractères au-delà de Latin-1 courants en français. */
  const CP1252 = {
    '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
    'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E,
    '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
    '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F
  };

  /* Encode une chaîne en octets cp1252 (un octet par caractère). */
  function versCp1252(texte) {
    const octets = [];
    for (const ch of String(texte)) {
      const code = ch.codePointAt(0);
      if (code < 256) octets.push(code);
      else if (CP1252[ch] !== undefined) octets.push(CP1252[ch]);
      else octets.push(0x3F); // '?' de repli hors cp1252
    }
    return octets;
  }

  /* Échappe une chaîne littérale PDF (antislash, parenthèses). */
  function echapper(texte) {
    return String(texte).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  const PAGE_W = 595;   // A4 en points (1 pt = 1/72 pouce)
  const PAGE_H = 842;
  const MARGE = 50;
  const INTERLIGNE = { titre: 24, 'sous-titre': 15, section: 20, texte: 16, petit: 13 };
  const TAILLE = { titre: 16, 'sous-titre': 10, section: 12, texte: 11, petit: 9 };

  /**
   * Construit un PDF A4 et retourne un Blob (application/pdf).
   * contenu = {
   *   titre: string,
   *   sousTitre: string (optionnel),
   *   lignes: [{ texte, style }]   // style : 'section' | 'texte' | 'petit'
   * }
   */
  function creerBlob(contenu) {
    const toutes = [];
    if (contenu.titre) toutes.push({ texte: contenu.titre, style: 'titre' });
    if (contenu.sousTitre) toutes.push({ texte: contenu.sousTitre, style: 'sous-titre' });
    if (contenu.sousTitre) toutes.push({ texte: '', style: 'petit' });
    for (const l of (contenu.lignes || [])) toutes.push(l);

    /* Découpe en pages en calculant la position y de chaque ligne. */
    const pages = [];
    let page = [];
    let y = PAGE_H - MARGE;
    for (const ligne of toutes) {
      const h = INTERLIGNE[ligne.style] || INTERLIGNE.texte;
      if (y - h < MARGE + 30 && page.length > 0) {
        pages.push(page);
        page = [];
        y = PAGE_H - MARGE;
      }
      page.push({ texte: ligne.texte, style: ligne.style || 'texte', y });
      y -= h;
    }
    if (page.length > 0 || pages.length === 0) pages.push(page);
    const totalPages = pages.length;

    /* Flux de contenu d'une page (texte positionné en absolu). */
    const fluxPage = (lignes, numPage) => {
      let s = '';
      for (const l of lignes) {
        const gras = l.style === 'titre' || l.style === 'section';
        const gris = l.style === 'sous-titre' || l.style === 'petit';
        s += 'BT\n' + (gras ? '/F2' : '/F1') + ' ' + (TAILLE[l.style] || 11) + ' Tf\n' +
          (gris ? '0.4 g\n' : '0 g\n') +
          MARGE + ' ' + Math.round(l.y) + ' Td\n(' + echapper(l.texte) + ') Tj\nET\n';
      }
      s += 'BT\n/F1 9 Tf\n0.4 g\n' + MARGE + ' 30 Td\n(Page ' + numPage + ' / ' + totalPages + ') Tj\nET\n';
      return versCp1252(s);
    };

    /* Numérotation des objets : 1 catalogue, 2 pages, 3/4 polices, puis
       pour chaque page i : page = 5 + 2i, contenu = 6 + 2i. */
    const nbPages = pages.length;
    const maxObj = 4 + 2 * nbPages;
    const objets = new Array(maxObj + 1).fill(null);
    const kids = pages.map((_, i) => (5 + 2 * i) + ' 0 R').join(' ');
    objets[1] = versCp1252('<< /Type /Catalog /Pages 2 0 R >>');
    objets[2] = versCp1252('<< /Type /Pages /Kids [' + kids + '] /Count ' + nbPages + ' >>');
    objets[3] = versCp1252('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    objets[4] = versCp1252('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    pages.forEach((lignes, i) => {
      const numPage = 5 + 2 * i;
      const numContenu = 6 + 2 * i;
      objets[numPage] = versCp1252('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] ' +
        '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + numContenu + ' 0 R >>');
      const flux = fluxPage(lignes, i + 1);
      objets[numContenu] = versCp1252('<< /Length ' + flux.length + ' >>\nstream\n').concat(flux, versCp1252('\nendstream'));
    });

    /* Assemblage du fichier avec table xref et offsets exacts. */
    const enTete = versCp1252('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const parties = [enTete];
    const offsets = new Array(maxObj + 1).fill(0);
    let decalage = enTete.length;
    for (let num = 1; num <= maxObj; num++) {
      offsets[num] = decalage;
      const debut = versCp1252(num + ' 0 obj\n');
      const fin = versCp1252('\nendobj\n');
      parties.push(debut, objets[num], fin);
      decalage += debut.length + objets[num].length + fin.length;
    }
    const posXref = decalage;
    let xref = 'xref\n0 ' + (maxObj + 1) + '\n0000000000 65535 f \n';
    for (let num = 1; num <= maxObj; num++) {
      xref += String(offsets[num]).padStart(10, '0') + ' 00000 n \n';
    }
    parties.push(versCp1252(xref));
    parties.push(versCp1252('trailer\n<< /Size ' + (maxObj + 1) + ' /Root 1 0 R >>\nstartxref\n' + posXref + '\n%%EOF\n'));

    const total = parties.reduce((n, p) => n + p.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const p of parties) { buf.set(p, off); off += p.length; }
    return new Blob([buf], { type: 'application/pdf' });
  }

  return {
    creerBlob,
    /* exposés pour les tests */
    _test: { versCp1252, echapper }
  };
})();

/* Exposition globale (navigateur : scripts classiques ; Node : globalThis). */
if (typeof globalThis !== 'undefined') globalThis.OmniPDF = OmniPDF;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OmniPDF;
}
