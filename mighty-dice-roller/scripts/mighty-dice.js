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
      die: form.querySelector('[name="die"]').value,
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

    // In some Foundry versions, html[0] is the window-content div.
    // Our <form> is inside it, but if for some reason it isn't,
    // we just treat html[0] itself as the "form container".
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
    if (countInput) countInput.value = 3;
    if (output) output.value = 3;

    const die = form.querySelector('[name="die"]');
    if (die) die.value = "d6";

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

  // ----------------- CORE ROLLER -----------------

  async _runRoll(cfg) {
    const specialFlavor = "red";
    const aimFlavor = "blue";

    const {
      count, die, label,
      vicious, headLevel, opportunist,
      centerMassLevel, advantage, disadvantageLvl
    } = cfg;

    const normalDice = count - 1;
    const specialCount = 1 + disadvantageLvl + (advantage ? 1 : 0);

    // special dice first, then normal dice
    let formula = `${specialCount}${die}x[${specialFlavor}]`;
    if (normalDice > 0) formula += ` + ${normalDice}${die}`;

    const mainRoll = await new Roll(formula).evaluate({ async: true });
    await mainRoll.toMessage({ flavor: label });

    const rawBase = mainRoll.total;

    // Special die results
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

    // Opportunist bonus (treat special as max)
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
          <p>Effective Special: <strong>${special}</strong></p>
          <p>Base: <strong>${rawBase}</strong></p>
        `
      });
      return;
    }

    // Crit extras
    let viciousTotal = 0;
    let aimTotal = 0;
    let overflowTotal = 0;

    if (vicious) {
      const v = await new Roll(`1${die}`).evaluate({ async: true });
      viciousTotal = v.total;
      await v.toMessage({ flavor: "Vicious (extra die on crit)" });
    }

    if (headLevel > 0) {
      const { upgradedDie, overflow } = this._increaseDieSizeTrackOverflow(die, headLevel);

      const aimRoll = await new Roll(`1${upgradedDie}x[${aimFlavor}]`).evaluate({ async: true });
      aimTotal = aimRoll.total;
      await aimRoll.toMessage({ flavor: `Aim for the Head (${headLevel})` });

      for (let i = 0; i < overflow; i++) {
        const o = await new Roll("1d20").evaluate({ async: true });
        overflowTotal += o.total;
        await o.toMessage({ flavor: "Aim Overflow (d20)" });
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
        <p>Special Die (after Adv/Dis): <strong>${special}</strong></p>
        <ul>
          <li>Raw Base: ${rawBase}</li>
          ${opportunistBonus ? `<li>Opportunist: +${opportunistBonus}</li>` : ""}
          <li>Effective Base: ${effectiveBase}</li>
          ${vicious ? `<li>Vicious: ${viciousTotal}</li>` : ""}
          ${headLevel ? `<li>Aim: ${aimTotal}</li>` : ""}
          ${overflowTotal ? `<li>Overflow: ${overflowTotal}</li>` : ""}
        </ul>
        <p><strong>Grand Total: ${final}</strong></p>
      `
    });
  }
}

// ---------------- HOOKS ----------------

Hooks.once("ready", async () => {
  // Create the app instance
  game.mightyDice = game.mightyDice || {};
  game.mightyDice.app = new MightyDiceApp();
  console.log("Mighty Dice Roller ready.");

  // --- Auto-create / auto-place macro ---

  const macroName = "Nimble Attack Roller";

  const command = `
if (game.mightyDice?.app) {
  game.mightyDice.app.render(true, { focus: true });
} else {
  ui.notifications.error("Mighty Dice Roller module is not ready.");
}
`.trim();

  // Try to find an existing macro with this name
  let macro = game.macros.find(m => m.name === macroName && m.type === "script");

  // If it doesn't exist, create it
  if (!macro) {
    macro = await Macro.create({
      name: macroName,
      type: "script",
      scope: "global",
      command,
      img: "icons/svg/d20-black.svg",
      flags: {
        "mighty-dice-roller": { autoCreated: true }
      }
    });
    ui.notifications.info("Mighty Dice Roller: macro created. It has been added to your hotbar.");
  }

  // Put it in the first empty hotbar slot for this user
  const user = game.user;
  const hotbar = user.getHotbarMacros(); // slots 1–50
  let emptySlot = null;

  for (let i = 1; i <= 50; i++) {
    if (!hotbar[i]) {
      emptySlot = i;
      break;
    }
  }

  if (emptySlot) {
    await user.assignHotbarMacro(macro, emptySlot);
  }
});