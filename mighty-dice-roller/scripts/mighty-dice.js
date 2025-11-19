// =============================================================
// Mighty Dice Roller Module - FoundryVTT
// Persistent Application (window stays open until YOU close it)
// Uses plain DOM event listeners for reliability.
// =============================================================

const MIGHTY_DICE_MODULE_ID = "mighty-dice-roller";

class MightyDiceApp extends Application {
  constructor(options = {}) {
    super(options);
    this.lastConfig = null; // for "Repeat Last"
  }

  static get defaultOptions() {
    const opts = super.defaultOptions;
    return foundry.utils.mergeObject(opts, {
      id: "mighty-dice-roller-app",
      title: "Mighty Dice Roller",
      template: `modules/${MIGHTY_DICE_MODULE_ID}/templates/mighty-dice.html`,
      width: 420,
      height: "auto",
      resizable: true,
      minimizable: true
    });
  }

  // Helper: read current form config
  _buildConfig(form) {
    return {
      count: Number(form.querySelector('[name="count"]').value),
      die: form.querySelector('[name="die"]').value,              // damage die
      specialDie: form.querySelector('[name="specialDie"]')
        ? form.querySelector('[name="specialDie"]').value        // special die (optional)
        : null,
      label: form.querySelector('[name="label"]').value || "Nimble Roll",
      vicious: form.querySelector('[name="vicious"]').checked,
      headLevel: Number(form.querySelector('[name="headLevel"]').value),
      opportunist: form.querySelector('[name="opportunist"]').checked,
      centerMassLevel: Number(form.querySelector('[name="centerMassLevel"]').value),
      advantage: form.querySelector('[name="advantage"]').checked,
      disadvantageLvl: Number(form.querySelector('[name="disadvantageLevel"]').value)
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    const root = html[0];
    let form = root.querySelector("form");
    if (!form) {
      console.warn("MightyDice: No <form> element found, using root as container.");
      form = root;
    }

    const rollBtn   = root.querySelector('[data-action="roll"]');
    const repeatBtn = root.querySelector('[data-action="repeat"]');
    const resetBtn  = root.querySelector('[data-action="reset"]');

    if (rollBtn) {
      rollBtn.addEventListener("click", (event) => {
        event.preventDefault();
        const cfg = this._buildConfig(form);
        this.lastConfig = cfg;
        this._runRoll(cfg);
      });
    }

    if (repeatBtn) {
      repeatBtn.addEventListener("click", (event) => {
        event.preventDefault();
        if (!this.lastConfig) {
          ui.notifications.warn("No previous roll to repeat.");
          return;
        }
        this._runRoll(this.lastConfig);
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", (event) => {
        event.preventDefault();
        this._resetForm(form);
      });
    }
  }

  _resetForm(form) {
    const countInput = form.querySelector('[name="count"]');
    const output = form.querySelector("output");
    if (countInput) countInput.value = 1;   // was 3
    if (output) output.value = 1;          // was 3

    const die = form.querySelector('[name="die"]');
    if (die) die.value = "d6";

    const specialDie = form.querySelector('[name="specialDie"]');
    if (specialDie) specialDie.value = "d6";

    const vicious = form.querySelector('[name="vicious"]');
    if (vicious) vicious.checked = false;

    const headLevel = form.querySelector('[name="headLevel"]');
    if (headLevel) headLevel.value = "0";

    const opportunist = form.querySelector('[name="opportunist"]');
    if (opportunist) opportunist.checked = false;

    const centerMassLevel = form.querySelector('[name="centerMassLevel"]');
    if (centerMassLevel) centerMassLevel.value = "0";

    const advantage = form.querySelector('[name="advantage"]');
    if (advantage) advantage.checked = false;

    const disadvantageLevel = form.querySelector('[name="disadvantageLevel"]');
    if (disadvantageLevel) disadvantageLevel.value = "0";

    const label = form.querySelector('[name="label"]');
    if (label) label.value = "";
  }

  // ----------------- DIE HELPERS -----------------

  _nextDieSizeOnce(die) {
    const map = { d4: "d6", d6: "d8", d8: "d10", d10: "d12", d12: "d20", d20: "d20" };
    return map[die] || die;
  }

  _increaseDieSizeTrackOverflow(die, steps) {
    let result = die;
    let overflow = 0;
    for (let i = 0; i < steps; i++) {
      const next = this._nextDieSizeOnce(result);
      if (result === "d20" && next === "d20") overflow++;
      result = next;
    }
    return { upgradedDie: result, overflow };
  }

  // ----------------- DOUBLE-DIGIT (d44 / d66 / d88) -----------------
  async _runDoubleDigitRoll(cfg) {
    const {
      count,
      die,
      label = "Nimble Roll",
      advantage,
      disadvantageLvl
    } = cfg;

    const faceMap = { d44: 4, d66: 6, d88: 8 };
    const faces = faceMap[die];

    if (!faces) {
      ui.notifications.error(`Unsupported double-digit die type: ${die}`);
      return;
    }

    const numResults = Math.max(1, Number.isFinite(count) ? count : 1);

    const disadv = Math.max(0, Number.isFinite(disadvantageLvl) ? disadvantageLvl : 0);
    const candidatesPerResult = 1 + disadv + (advantage ? 1 : 0);

    const allRolls = [];
    const finalValues = [];
    const lines = [];

    for (let r = 0; r < numResults; r++) {
      const tensRoll = await new Roll(`${candidatesPerResult}d${faces}`).evaluate({ async: true });
      const onesRoll = await new Roll(`${candidatesPerResult}d${faces}`).evaluate({ async: true });

      allRolls.push(tensRoll, onesRoll);

      const tensResults = tensRoll.terms[0].results.map(rr => rr.result);
      const onesResults = onesRoll.terms[0].results.map(rr => rr.result);

      const pairs = [];
      for (let i = 0; i < candidatesPerResult; i++) {
        const special = tensResults[i];
        const normal  = onesResults[i];
        const total   = (10 * special) + normal;
        pairs.push({ special, normal, total });
      }

      let chosenIndex = 0;

      if (disadv > 0 && pairs.length > 1) {
        let min = pairs[0].total;
        chosenIndex = 0;
        for (let i = 1; i < pairs.length; i++) {
          if (pairs[i].total < min) {
            min = pairs[i].total;
            chosenIndex = i;
          }
        }
      } else if (advantage && pairs.length > 1) {
        let max = pairs[0].total;
        chosenIndex = 0;
        for (let i = 1; i < pairs.length; i++) {
          if (pairs[i].total > max) {
            max = pairs[i].total;
            chosenIndex = i;
          }
        }
      }

      const chosen = pairs[chosenIndex];
      finalValues.push(chosen.total);

      const candidatesText = pairs.length > 1
        ? `; candidates: [${pairs.map(p => p.total).join(", ")}]`
        : "";

      lines.push(`
        <li>
          Result ${r + 1}: <strong>${chosen.total}</strong>
          (special/tens: ${chosen.special}, normal/ones: ${chosen.normal}${candidatesText})
        </li>
      `);
    }

    const grandTotal = finalValues.reduce((a, b) => a + b, 0);

    const content = `
      <div class="nimble-double-digit-roll">
        <p><strong>${label} – ${die.toUpperCase()} (${numResults} result${numResults === 1 ? "" : "s"})</strong></p>
        <ul>${lines.join("")}</ul>
        <p><strong>Sum of all ${die.toUpperCase()} results:</strong> ${grandTotal}</p>
      </div>
    `;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker(),
      content,
      type: CONST.CHAT_MESSAGE_TYPES.ROLL,
      rolls: allRolls
    });
  }

  // ----------------- CORE ROLLER -----------------

  async _runRoll(cfg) {
    const specialFlavor = "red";
    const aimFlavor = "blue";

    const {
      count,
      die,          // damage die
      specialDie,   // optional special die
      label,
      vicious, headLevel, opportunist,
      centerMassLevel, advantage, disadvantageLvl
    } = cfg;

    // Double-digit dice bypass special/damage split and use their own handler
    if (die === "d44" || die === "d66" || die === "d88") {
      await this._runDoubleDigitRoll(cfg);
      return;
    }

    const sDie = specialDie || die; // fallback: if no special die chosen, use damage die

    const normalDice = count - 1;
    const specialCount = 1 + disadvantageLvl + (advantage ? 1 : 0);

    // special dice use sDie, normal dice use damage die
    let formula = `${specialCount}${sDie}x[${specialFlavor}]`;
    if (normalDice > 0) formula += ` + ${normalDice}${die}`;

    const mainRoll = await new Roll(formula).evaluate({ async: true });
    await mainRoll.toMessage({ flavor: label });

    const rawBase = mainRoll.total;

    // Special die term is the first dice term (sDie)
    const specialTerm = mainRoll.dice[0];
    let specialFaces = null;
    let results = [];

    if (specialTerm) {
      specialFaces = specialTerm.faces;
      for (const r of specialTerm.results) {
        if (!r.discarded && !r.rerolled) {
          results.push(r.result);
        }
      }
    }

    let special = null;
    if (results.length) {
      if (disadvantageLvl > 0) {
        special = Math.min(...results);
      } else if (advantage) {
        special = Math.max(...results);
      } else {
        special = results[0];
      }
    }

    // MISS: special = 1 and no Opportunist
    if (special === 1 && !opportunist) {
      await ChatMessage.create({
        content: `<p><strong>Miss!</strong> Special die = 1. Damage = <strong>0</strong>.</p>`
      });
      return;
    }

    // CRIT?
    let isCrit = false;
    const isMax = specialFaces && special === specialFaces;
    if (opportunist || isMax) isCrit = true;

    // Opportunist bonus (treat special as max of sDie)
    let opportunistBonus = 0;
    let effectiveBase = rawBase;

    if (opportunist && specialFaces && special < specialFaces) {
      opportunistBonus = specialFaces - special;
      effectiveBase += opportunistBonus;
    }

    // Non-crit path
    if (!isCrit) {
      await ChatMessage.create({
        content: `
          <p><strong>No Crit.</strong></p>
          <p>Special Die (${sDie}) after Adv/Dis: <strong>${special}</strong></p>
          <p>Base Damage (using ${die}): <strong>${rawBase}</strong></p>
        `
      });
      return;
    }

    // Crit extras
    let viciousTotal = 0;
    let aimTotal = 0;
    let overflowTotal = 0;

    // Vicious uses the damage die
    if (vicious) {
      const v = await new Roll(`1${die}`).evaluate({ async: true });
      viciousTotal = v.total;
      await v.toMessage({ flavor: "Vicious (extra die on crit)" });
    }

    // Aim for the Head upgrades the SPECIAL die
    if (headLevel > 0) {
      const { upgradedDie, overflow } = this._increaseDieSizeTrackOverflow(sDie, headLevel);

      const aimRoll = await new Roll(`1${upgradedDie}x[${aimFlavor}]`).evaluate({ async: true });
      aimTotal = aimRoll.total;
      await aimRoll.toMessage({
        flavor: `Aim for the Head (${headLevel}) – upgraded ${sDie} to ${upgradedDie}`
      });

      for (let i = 0; i < overflow; i++) {
        const o = await new Roll("1d20").evaluate({ async: true });
        overflowTotal += o.total;
        await o.toMessage({ flavor: "Aim Overflow (d20 from capped special die)" });
      }
    }

    const extras = viciousTotal + aimTotal + overflowTotal;
    const final = effectiveBase + extras;

    const centerLine = centerMassLevel > 0
      ? `<p><em>Center Mass (${centerMassLevel}): extra flourish / bonus flurry.</em></p>`
      : "";

    await ChatMessage.create({
      content: `
        <p><strong>CRITICAL HIT!</strong></p>
        ${centerLine}
        <p>Special Die (${sDie}) after Adv/Dis: <strong>${special}</strong></p>
        <ul>
          <li>Raw Base (using ${die}): ${rawBase}</li>
          ${opportunistBonus ? `<li>Opportunist: +${opportunistBonus}</li>` : ""}
          <li>Effective Base: ${effectiveBase}</li>
          ${vicious ? `<li>Vicious (${die}): ${viciousTotal}</li>` : ""}
          ${headLevel ? `<li>Aim (upgraded ${sDie}): ${aimTotal}</li>` : ""}
          ${overflowTotal ? `<li>Overflow: ${overflowTotal}</li>` : ""}
        </ul>
        <p><strong>Grand Total: ${final}</strong></p>
      `
    });
  }
}

// ---------------------------------------------------------------
// MAKE CLASS PUBLIC SO THE MACRO CAN ACCESS IT
// ---------------------------------------------------------------
globalThis.MightyDiceApp = MightyDiceApp;

// ---------------- HOOKS ----------------

Hooks.once("ready", async () => {
  game.mightyDice = game.mightyDice || {};
  game.mightyDice.app = game.mightyDice.app || new MightyDiceApp();
  console.log("Mighty Dice Roller ready.");

  const macroName = "Nimble Attack Roller";

  const command = `
if (!game.mightyDice) game.mightyDice = {};
if (!game.mightyDice.app) {
  if (typeof MightyDiceApp !== "undefined") {
    game.mightyDice.app = new MightyDiceApp();
  } else {
    ui.notifications.error("Mighty Dice Roller script is not loaded.");
    return;
  }
}
game.mightyDice.app.render(true, { focus: true });
`.trim();

  // Try to find existing macro
  let macro = game.macros.find(m => m.name === macroName && m.type === "script");

  if (!macro) {
    macro = await Macro.create({
      name: macroName,
      type: "script",
      scope: "global",
      command,
      img: "icons/svg/d20-black.svg",
      flags: { "mighty-dice-roller": { autoCreated: true } }
    });
    ui.notifications.info("Mighty Dice Roller: macro created and added to hotbar.");
  } else if (macro.command !== command) {
    await macro.update({ command });
  }

  const user = game.user;
  const hotbar = user.getHotbarMacros();

  let emptySlot = null;
  for (let i = 1; i <= 50; i++) {
    if (!hotbar[i]) { emptySlot = i; break; }
  }

  if (emptySlot) user.assignHotbarMacro(macro, emptySlot);
});