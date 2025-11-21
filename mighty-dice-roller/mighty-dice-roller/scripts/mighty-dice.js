// =============================================================
// Mighty Dice Roller Module - FoundryVTT
// =============================================================

class MightyDiceRoller extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "mighty-dice-roller",
      title: "Mighty Dice Roller",
      template: "modules/mighty-dice-roller/templates/mighty-dice.html",
      width: 620,
      height: "auto",
      resizable: true
    });
  }

  constructor(...args) {
    super(...args);

    // For "Repeat Last"
    this.lastConfig = null;

    // Local-only class pool storage (not stored on actor)
    this.poolValues = [];
  }

  getData(options = {}) {
    const data = super.getData(options);
    return data;
  }

  // -----------------------------------------------------------
  // Activate listeners
  // -----------------------------------------------------------
  activateListeners(html) {
    super.activateListeners(html);

    let form = null;

    // Try to find a <form> among the top-level nodes
    for (const el of html) {
      if (el instanceof HTMLFormElement) {
        form = el;
        break;
      }
    }

    // Fallback: search descendants
    if (!form) {
      form = html.find("form")[0];
    }

    // Ultimate fallback
    if (!form) {
      console.warn("MightyDice: Template has no <form>; using first node as root.");
      form = html[0];
    }

    const root = form;

    const rollBtn   = root.querySelector('[data-action="roll"]');
    const repeatBtn = root.querySelector('[data-action="repeat"]');
    const resetBtn  = root.querySelector('[data-action="reset"]');

    if (rollBtn) {
      rollBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        const cfg = this._buildConfig(form);
        this.lastConfig = cfg;
        await this._runRoll(cfg);
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

    // ----------------------------------------------
    // Tabs
    // ----------------------------------------------
    const tabButtons = root.querySelectorAll(".mighty-dice-tabs .tab-button");
    const tabPanels  = root.querySelectorAll(".tab-panel");

    tabButtons.forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        const target = btn.dataset.tab;
        if (!target) return;

        tabButtons.forEach((b) => {
          b.classList.toggle("active", b === btn);
        });

        tabPanels.forEach((panel) => {
          const panelTab = panel.dataset.tabPanel;
          panel.classList.toggle("active", panelTab === target);
        });
      });
    });

    // Init class pool UI
    this._initClassPool(form);

    // Generate / roll pool values from current pool
    const generateBtn = form.querySelector('[data-action="generate-pool-values"]');
    if (generateBtn) {
      generateBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        const cfg = this._buildConfig(form);
        await this._generatePoolFromCurrent(form, cfg);
      });
    }

    const rollPoolBtn = form.querySelector('[data-action="roll-pool"]');
    if (rollPoolBtn) {
      rollPoolBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        const cfg = this._buildConfig(form);
        await this._rollPool(form, cfg);
      });
    }

    const rerollBtn = form.querySelector('[data-action="reroll-lowest-pool"]');
    if (rerollBtn) {
      rerollBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        const cfg = this._buildConfig(form);
        await this._rerollLowestPoolDie(form, cfg);
      });
    }

    const spendOnlyBtn = form.querySelector('[data-action="spend-pool-only"]');
    if (spendOnlyBtn) {
      spendOnlyBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        const cfg = this._buildConfig(form);
        await this._spendPoolOnly(form, cfg);
      });
    }

    const chaosBtn = form.querySelector('[data-action="chaos-roll"]');
    if (chaosBtn) {
      chaosBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        const cfg = this._buildConfig(form);
        await this._chaosRoll(form, cfg);
      });
    }

    // Class Dice Pool show/hide
    const poolSection = form.querySelector('[data-section="class-pool"]');
    const poolToggle  = form.querySelector('[data-action="toggle-pool-section"]');
    if (poolSection && poolToggle) {
      poolToggle.addEventListener("click", (event) => {
        event.preventDefault();
        const isHidden = poolSection.style.display === "none";
        poolSection.style.display = isHidden ? "" : "none";
      });
    }

    // Click-to-select stored pool values
    const poolDisplay = form.querySelector('[data-pool-values-display]');
    if (poolDisplay) {
      poolDisplay.addEventListener("click", (event) => {
        const target = event.target.closest(".pool-value");
        if (!target) return;
        event.preventDefault();
        const isSelected = target.classList.toggle("selected");
        if (isSelected) {
          target.style.fontWeight = "bold";
          target.style.textDecoration = "underline";
        } else {
          target.style.fontWeight = "";
          target.style.textDecoration = "";
        }
      });
    }

    // Class Ability Uses: toggle dots & add new rows
    form.addEventListener("click", (event) => {
      const target = event.target;

      if (target.dataset && target.dataset.usageDot) {
        event.preventDefault();
        target.textContent = (target.textContent === "●") ? "○" : "●";
        return;
      }

      if (target.dataset && target.dataset.action === "add-usage-row") {
        event.preventDefault();
        const type = target.dataset.usageType;
        if (!type) return;

        const group = form.querySelector(`.usage-group[data-usage-type="${type}"]`);
        if (!group) return;

        const firstRow = group.querySelector(".usage-row");
        if (!firstRow) return;

        const clone = firstRow.cloneNode(true);

        const label = clone.querySelector(".usage-label");
        if (label) label.value = "";

        clone.querySelectorAll("[data-usage-dot]").forEach((dot) => {
          dot.textContent = "○";
        });

        group.appendChild(clone);
      }
    });
  }

  // -----------------------------------------------------------
  // Build config from form
  // -----------------------------------------------------------
  _buildConfig(form) {
    const count = Number(form.count?.value ?? 1) || 1;
    const die = form.die?.value || "d6";               // Damage die
    const specialDie = form.specialDie?.value || "d6"; // Primary die

    const headLevel = Number(form.headLevel?.value ?? 0) || 0;
    const centerMassLevel = Number(form.centerMassLevel?.value ?? 0) || 0;

    const advantageLevel = Number(form.advantageLevel?.value ?? 0) || 0;
    const disadvantageLevel = Number(form.disadvantageLevel?.value ?? 0) || 0;

    const label = form.label?.value || "";

    const vicious    = Boolean(form.vicious?.checked);
    const cheapShot  = Boolean(form.cheapShot?.checked);
    const jousting   = Boolean(form.jousting?.checked);
    const quick      = Boolean(form.quick?.checked);
    const aggressive = Boolean(form.aggressive?.checked);

    // Sneak
    const sneakCount = Number(form.sneakCount?.value ?? 0) || 0;
    const sneakDie = form.sneakDie?.value || "";
    const sneakFixedRaw = form.sneakFixed?.value;
    const sneakFixed = sneakFixedRaw === "" ? null : Number(sneakFixedRaw);

    // Special fixed (override primary)
    const specialFixedRaw = form.specialFixed?.value;
    const specialFixed = specialFixedRaw === "" ? null : Number(specialFixedRaw);

    // Class Dice Pool
    const poolDie = form.poolDie?.value || "d6";
    const poolCurrent = Number(form.poolCurrent?.value ?? 0) || 0;
    const poolSpend = Number(form.poolSpend?.value ?? 0) || 0;

    const rageActive = Boolean(form.rageActive?.checked);

    const selectedIndices = this._getSelectedPoolIndices(form);

    return {
      count,
      die,
      specialDie,
      headLevel,
      centerMassLevel,
      advantageLevel,
      disadvantageLevel,
      label,
      vicious,
      sneakCount,
      sneakDie,
      sneakFixed,
      specialFixed,
      poolDie,
      poolCurrent,
      poolSpend,
      rageActive,
      poolValues: this.poolValues.slice(),
      selectedPoolIndices: selectedIndices,
      cheapShot,
      jousting,
      quick,
      aggressive
    };
  }

  // -----------------------------------------------------------
  // Reset form
  // -----------------------------------------------------------
  _resetForm(form) {
    this.poolValues = [];

    const countInput = form.querySelector('[name="count"]');
    const output = form.querySelector('output[name="die-count"]');
    if (countInput) countInput.value = 1;
    if (output) output.value = 1;

    const die = form.querySelector('[name="die"]');
    if (die) die.value = "d6";

    const specialDie = form.querySelector('[name="specialDie"]');
    if (specialDie) specialDie.value = "d6";

    const headLevel = form.querySelector('[name="headLevel"]');
    if (headLevel) headLevel.value = "0";

    const centerMassLevel = form.querySelector('[name="centerMassLevel"]');
    if (centerMassLevel) centerMassLevel.value = "0";

    const advantageLevel = form.querySelector('[name="advantageLevel"]');
    if (advantageLevel) advantageLevel.value = "0";

    const disadvantageLevel = form.querySelector('[name="disadvantageLevel"]');
    if (disadvantageLevel) disadvantageLevel.value = "0";

    const advDisSlider = form.querySelector('[name="advDisSlider"]');
    if (advDisSlider) advDisSlider.value = "0";

    const advDisLabel = form.querySelector("[data-advdis-label]");
    if (advDisLabel) advDisLabel.textContent = "Normal";

    const label = form.querySelector('[name="label"]');
    if (label) label.value = "";

    const vicious = form.querySelector('[name="vicious"]');
    if (vicious) vicious.checked = false;

    const rage = form.querySelector('[name="rageActive"]');
    if (rage) rage.checked = false;

    // Sneak
    const sneakCount = form.querySelector('[name="sneakCount"]');
    const sneakOutput = form.querySelector('output[name="sneak-count"]');
    if (sneakCount) sneakCount.value = "0";
    if (sneakOutput) sneakOutput.value = "0";

    const sneakDie = form.querySelector('[name="sneakDie"]');
    if (sneakDie) sneakDie.value = "";

    const sneakFixed = form.querySelector('[name="sneakFixed"]');
    if (sneakFixed) sneakFixed.value = "";

    const specialFixed = form.querySelector('[name="specialFixed"]');
    if (specialFixed) specialFixed.value = "";

    // Class Dice Pool
    const poolDie = form.querySelector('[name="poolDie"]');
    if (poolDie) poolDie.value = "d6";

    const poolCurrent = form.querySelector('[name="poolCurrent"]');
    const poolCurrentOutput = form.querySelector('output[name="pool-current-output"]');
    if (poolCurrent) poolCurrent.value = "0";
    if (poolCurrentOutput) poolCurrentOutput.value = "0";

    const poolSpend = form.querySelector('[name="poolSpend"]');
    const poolSpendOutput = form.querySelector('output[name="pool-spend-output"]');
    if (poolSpend) {
      poolSpend.value = "0";
      poolSpend.max = "0";
    }
    if (poolSpendOutput) poolSpendOutput.value = "0";

    this._updatePoolValuesDisplay(form);

    // Class Ability Uses
    const usageGroups = form.querySelectorAll(".usage-group");
    usageGroups.forEach((group) => {
      const rows = group.querySelectorAll(".usage-row");
      rows.forEach((row, idx) => {
        const labelInput = row.querySelector(".usage-label");
        if (labelInput) labelInput.value = "";
        row.querySelectorAll("[data-usage-dot]").forEach((dot) => {
          dot.textContent = "○";
        });
        if (idx > 0) row.remove();
      });
    });
  }

  // -----------------------------------------------------------
  // Class Dice Pool helpers
  // -----------------------------------------------------------
  _initClassPool(form) {
    const poolCurrentInput = form.querySelector('[name="poolCurrent"]');
    const poolCurrentOutput = form.querySelector('output[name="pool-current-output"]');
    const poolSpendInput = form.querySelector('[name="poolSpend"]');
    const poolSpendOutput = form.querySelector('output[name="pool-spend-output"]');

    let currentPool = 0;

    if (poolCurrentInput) {
      const raw = Number(poolCurrentInput.value || 0);
      currentPool = Number.isFinite(raw) ? raw : 0;
      currentPool = Math.max(0, Math.min(8, currentPool));
    }

    if (poolCurrentOutput) {
      poolCurrentOutput.value = String(currentPool);
    }

    if (poolSpendInput) {
      poolSpendInput.value = "0";
      poolSpendInput.max = String(currentPool);
    }

    if (poolSpendOutput) {
      poolSpendOutput.value = "0";
    }

    if (poolCurrentInput) {
      poolCurrentInput.addEventListener("input", (event) => {
        const value = Number(event.target.value || 0);
        const clamped = Math.max(0, Math.min(8, value));
        event.target.value = String(clamped);

        if (poolCurrentOutput) {
          poolCurrentOutput.value = String(clamped);
        }

        if (poolSpendInput) {
          const spendVal = Math.min(clamped, Number(poolSpendInput.value || 0));
          poolSpendInput.max = String(clamped);
          poolSpendInput.value = String(spendVal);
          if (poolSpendOutput) poolSpendOutput.value = String(spendVal);
        }
      });
    }

    if (poolSpendInput) {
      poolSpendInput.addEventListener("input", (event) => {
        const value = Number(event.target.value || 0);
        const maxVal = Number(poolSpendInput.max || 0);
        const clamped = Math.max(0, Math.min(maxVal, value));
        event.target.value = String(clamped);
        if (poolSpendOutput) {
          poolSpendOutput.value = String(clamped);
        }
      });
    }

    this._updatePoolValuesDisplay(form);
  }

  _updatePoolValuesDisplay(form) {
    const display = form.querySelector('[data-pool-values-display]');
    if (!display) return;

    if (!this.poolValues || this.poolValues.length === 0) {
      display.textContent = "None";
      return;
    }

    display.innerHTML = "";
    this.poolValues.forEach((val, idx) => {
      const span = document.createElement("span");
      span.className = "pool-value";
      span.dataset.poolIndex = String(idx);
      span.textContent = (idx > 0 ? ", " : "") + String(val);
      display.appendChild(span);
    });
  }

  _getSelectedPoolIndices(form) {
    const display = form.querySelector('[data-pool-values-display]');
    if (!display) return [];
    const selected = display.querySelectorAll(".pool-value.selected");
    return Array.from(selected)
      .map((el) => Number(el.dataset.poolIndex))
      .filter((i) => Number.isInteger(i) && i >= 0);
  }

  // -----------------------------------------------------------
  // Pool behaviours
  // -----------------------------------------------------------
  async _generatePoolFromCurrent(form, cfg) {
    let currentPool = Number.isFinite(cfg.poolCurrent) ? cfg.poolCurrent : 0;
    currentPool = Math.max(0, Math.min(8, currentPool));

    if (!currentPool) {
      ui.notifications.warn("Pool is 0; nothing to generate.");
      return;
    }

    const faces = this._parseDieFaces(cfg.poolDie);
    if (!faces) {
      ui.notifications.error(`Invalid pool die: ${cfg.poolDie}`);
      return;
    }

    const poolRoll = await new Roll(`${currentPool}d${faces}`).evaluate({ async: true });
    this.poolValues = poolRoll.terms[0].results.map((r) => r.result);

    this._updatePoolValuesDisplay(form);

    const flavor = cfg.label
      ? `Class Dice Pool for ${cfg.label}`
      : "Class Dice Pool Roll";
    poolRoll.toMessage({
      speaker: ChatMessage.getSpeaker(),
      flavor
    });

    const poolCurrentInput = form.querySelector('[name="poolCurrent"]');
    const poolCurrentOutput = form.querySelector('output[name="pool-current-output"]');
    if (poolCurrentInput) poolCurrentInput.value = String(currentPool);
    if (poolCurrentOutput) poolCurrentOutput.value = String(currentPool);

    const poolSpendInput = form.querySelector('[name="poolSpend"]');
    const poolSpendOutput = form.querySelector('output[name="pool-spend-output"]');
    if (poolSpendInput) {
      let spendVal = Number(poolSpendInput.value || 0);
      spendVal = Math.min(currentPool, Math.max(0, spendVal));
      poolSpendInput.max = String(currentPool);
      poolSpendInput.value = String(spendVal);
      if (poolSpendOutput) poolSpendOutput.value = String(spendVal);
    }
  }

  async _rollPool(form, cfg) {
    let currentPool = Number.isFinite(cfg.poolCurrent) ? cfg.poolCurrent : 0;
    currentPool = Math.max(0, Math.min(8, currentPool));

    if (!currentPool) {
      ui.notifications.warn("Pool is 0; nothing to roll.");
      return;
    }

    const faces = this._parseDieFaces(cfg.poolDie);
    if (!faces) {
      ui.notifications.error(`Invalid pool die: ${cfg.poolDie}`);
      return;
    }

    const actor = this._getActor();
    const speaker = actor
      ? ChatMessage.getSpeaker({ actor })
      : ChatMessage.getSpeaker();

    const roll = await new Roll(`${currentPool}d${faces}`).evaluate({ async: true });
    const label = cfg.label ? ` for ${cfg.label}` : "";
    const flavor = `Class Dice Pool Roll${label}`;

    await roll.toMessage({
      speaker,
      flavor
    });
  }

  async _rerollLowestPoolDie(form, cfg) {
    if (!this.poolValues || this.poolValues.length === 0) {
      ui.notifications.warn("No stored pool values to reroll.");
      return;
    }

    const faces = this._parseDieFaces(cfg.poolDie);
    if (!faces) {
      ui.notifications.error(`Invalid pool die: ${cfg.poolDie}`);
      return;
    }

    let minVal = this.poolValues[0];
    let minIdx = 0;
    for (let i = 1; i < this.poolValues.length; i++) {
      if (this.poolValues[i] < minVal) {
        minVal = this.poolValues[i];
        minIdx = i;
      }
    }

    const roll = await new Roll(`1d${faces}`).evaluate({ async: true });
    const newVal = roll.total;

    this.poolValues[minIdx] = newVal;
    this._updatePoolValuesDisplay(form);

    roll.toMessage({
      speaker: ChatMessage.getSpeaker(),
      flavor: `Reroll lowest pool die (was ${minVal}, now ${newVal})`
    });
  }

  async _spendPoolOnly(form, cfg) {
    const indices = cfg.selectedPoolIndices && cfg.selectedPoolIndices.length
      ? cfg.selectedPoolIndices.slice()
      : [];

    if (!indices.length) {
      ui.notifications.warn("No pool dice selected to spend.");
      return;
    }

    const faces = this._parseDieFaces(cfg.poolDie);
    if (!faces) {
      ui.notifications.error(`Invalid pool die: ${cfg.poolDie}`);
      return;
    }

    const count = indices.length;
    const poolRoll = await new Roll(`${count}d${faces}`).evaluate({ async: true });

    const label = cfg.label ? ` for ${cfg.label}` : "";
    const flavor = `Class Dice Pool Only${label}`;

    poolRoll.toMessage({
      speaker: ChatMessage.getSpeaker(),
      flavor
    });

    indices.sort((a, b) => b - a).forEach((idx) => {
      if (idx >= 0 && idx < this.poolValues.length) {
        this.poolValues.splice(idx, 1);
      }
    });

    this._updatePoolValuesDisplay(form);

    const newCount = Math.max(0, Math.min(8, this.poolValues.length));
    const poolCurrentInput = form.querySelector('[name="poolCurrent"]');
    const poolCurrentOutput = form.querySelector('output[name="pool-current-output"]');
    if (poolCurrentInput) poolCurrentInput.value = String(newCount);
    if (poolCurrentOutput) poolCurrentOutput.value = String(newCount);

    const poolSpendInput = form.querySelector('[name="poolSpend"]');
    const poolSpendOutput = form.querySelector('output[name="pool-spend-output"]');
    if (poolSpendInput) {
      let spendVal = Number(poolSpendInput.value || 0);
      spendVal = Math.min(newCount, Math.max(0, spendVal));
      poolSpendInput.max = String(newCount);
      poolSpendInput.value = String(spendVal);
      if (poolSpendOutput) poolSpendOutput.value = String(spendVal);
    }
  }

  async _chaosRoll(form, cfg) {
    const actor = this._getActor();
    const speaker = actor
      ? ChatMessage.getSpeaker({ actor })
      : ChatMessage.getSpeaker();

    const roll = await new Roll("1d20").evaluate({ async: true });
    const label = cfg.label ? ` for ${cfg.label}` : "";
    const flavor = `Chaotic Surge${label}`;

    await roll.toMessage({
      speaker,
      flavor
    });
  }

  // -----------------------------------------------------------
  // Main roll logic
  // -----------------------------------------------------------
  async _runRoll(cfg) {
    const actor = this._getActor();
    const speaker = actor
      ? ChatMessage.getSpeaker({ actor })
      : ChatMessage.getSpeaker();

    const totalDice = Math.max(1, Number.isFinite(cfg.count) ? cfg.count : 1);
    const numDamageDice = Math.max(0, totalDice - 1);

    // Primary / damage dice faces
    const primaryFaces = this._parseDieFaces(cfg.specialDie);
    if (!primaryFaces) {
      ui.notifications.error("Invalid primary die selection.");
      return;
    }

    const damageDieStr = cfg.die;
    const isCompoundDamageDie = ["d44", "d66", "d88"].includes(damageDieStr);
    const damageFaces = isCompoundDamageDie ? null : this._parseDieFaces(damageDieStr);

    if (!damageFaces && !isCompoundDamageDie && numDamageDice > 0) {
      ui.notifications.error("Invalid damage die selection.");
      return;
    }

    const { headLevel = 0, centerMassLevel = 0 } = cfg;

    const advantageLvl = Math.max(0, Number.isFinite(cfg.advantageLevel) ? cfg.advantageLevel : 0);
    const disadvantageLvl = Math.max(0, Number.isFinite(cfg.disadvantageLevel) ? cfg.disadvantageLevel : 0);

    const netAdv = advantageLvl - disadvantageLvl;
    const hasAdv = netAdv > 0;
    const hasDis = netAdv < 0;
    const candidateCount = 1 + Math.abs(netAdv);

    const sneakCount = Math.max(0, Number.isFinite(cfg.sneakCount) ? cfg.sneakCount : 0);
    const sneakFaces = cfg.sneakDie ? this._parseDieFaces(cfg.sneakDie) : null;
    const sneakFixed = cfg.sneakFixed ?? null;
    const sneakValues = []; // final per-die faces for DNS

    const specialFixed = cfg.specialFixed ?? null;
    const vicious      = Boolean(cfg.vicious);
    const cheapShot    = Boolean(cfg.cheapShot);
    const jousting     = Boolean(cfg.jousting);
    const quick        = Boolean(cfg.quick);
    const aggressive   = Boolean(cfg.aggressive);

    const poolDieFaces = this._parseDieFaces(cfg.poolDie);
    let poolCurrent = Math.max(0, Number.isFinite(cfg.poolCurrent) ? cfg.poolCurrent : 0);
    let poolSpend = Math.max(0, Number.isFinite(cfg.poolSpend) ? cfg.poolSpend : 0);
    poolCurrent = Math.min(poolCurrent, 8);
    poolSpend = Math.min(poolSpend, poolCurrent);

    const rageActive = Boolean(cfg.rageActive);

    const storedPoolValues = Array.isArray(cfg.poolValues) ? cfg.poolValues.slice() : [];
    const selectedIndices = Array.isArray(cfg.selectedPoolIndices) ? cfg.selectedPoolIndices.slice() : [];

    const poolDiceToUse = selectedIndices.map((i) => storedPoolValues[i]).filter((v) => Number.isFinite(v));
    const rageDiceValues = rageActive ? storedPoolValues.slice() : [];

    // Helper: roll one full candidate (primary + damage) for adv/dis
    const rollBaseCandidate = async () => {
      const candidate = {
        primaryVal: 0,
        primaryRoll: null,
        damageValues: [],
        damageRolls: []
      };

      // Primary
      const primaryRoll = await new Roll(`1d${primaryFaces}`).evaluate({ async: true });
      candidate.primaryRoll = primaryRoll;
      candidate.primaryVal = primaryRoll.total;

      // Damage
      if (numDamageDice > 0) {
        if (isCompoundDamageDie) {
          const baseFaces = Number(damageDieStr[2]); // "4", "6", or "8"
          for (let i = 0; i < numDamageDice; i++) {
            const roll = await new Roll(`2d${baseFaces}`).evaluate({ async: true });
            candidate.damageRolls.push(roll);

            const results = roll.terms[0].results.map((r) => r.result);
            const tens = results[0];
            const ones = results[1];
            const value = (tens * 10) + ones;
            candidate.damageValues.push(value);
          }
        } else {
          for (let i = 0; i < numDamageDice; i++) {
            const roll = await new Roll(`1d${damageFaces}`).evaluate({ async: true });
            candidate.damageRolls.push(roll);
            candidate.damageValues.push(roll.total);
          }
        }
      }

      return candidate;
    };

    // Roll candidates for adv/dis
    let chosenCandidate;
    if (!hasAdv && !hasDis) {
      chosenCandidate = await rollBaseCandidate();
    } else {
      const candidates = [];
      for (let i = 0; i < candidateCount; i++) {
        candidates.push(await rollBaseCandidate());
      }

      let chosenIndex = 0;
      let chosenPrimary = candidates[0].primaryVal;

      for (let i = 1; i < candidates.length; i++) {
        const candPrim = candidates[i].primaryVal;
        if ((hasAdv && candPrim > chosenPrimary) || (hasDis && candPrim < chosenPrimary)) {
          chosenPrimary = candPrim;
          chosenIndex = i;
        }
      }

      chosenCandidate = candidates[chosenIndex];
    }

    // Base primary result (after special fixed override)
    let primaryBase = chosenCandidate.primaryVal;
    if (Number.isFinite(specialFixed)) {
      primaryBase = specialFixed;
    }

    const isCrit = primaryBase === primaryFaces;

    // Aim for the Head: adjust primary explosion die & overflow d20s (on crit only)
    let explosionPrimaryFaces = primaryFaces;
    let headOverflowCount = 0;
    if (isCrit && headLevel > 0) {
      const headResult = this._applyHeadScaling(primaryFaces, headLevel);
      explosionPrimaryFaces = headResult.primaryFaces;
      headOverflowCount = headResult.overflowCount;
    }

    // Center Mass: crit-only flavor text, no mechanics
    let centerMassFlavor = "";
    if (isCrit && centerMassLevel > 0) {
      centerMassFlavor = `You flourish your firearms with deadly skill and prepare for another barrage. (${centerMassLevel})`;
    }

    // Exploding primary (using adjusted explosionPrimaryFaces)
    const primaryExtraRolls = [];
    let primaryTotal = primaryBase;

    if (isCrit) {
      while (true) {
        const roll = await new Roll(`1d${explosionPrimaryFaces}`).evaluate({ async: true });
        const val = roll.total;
        primaryExtraRolls.push(val);
        primaryTotal += val;
        if (val !== explosionPrimaryFaces) break;
      }
    }

    // Damage (base weapon dice)
    const damageBreakdown = chosenCandidate.damageValues.slice();
    let damageTotal = damageBreakdown.reduce((a, b) => a + b, 0);

    // Head overflow: extra d20 damage dice (no further scaling)
    if (isCrit && headOverflowCount > 0) {
      const overflowRoll = await new Roll(`${headOverflowCount}d20`).evaluate({ async: true });
      const overflowResults = overflowRoll.terms[0].results.map((r) => r.result);
      const overflowSum = overflowResults.reduce((a, b) => a + b, 0);
      damageBreakdown.push(...overflowResults);
      damageTotal += overflowSum;
    }

    // Start total: primary + all damage dice so far
    let total = primaryTotal + damageTotal;

    // Vicious: extra damage on crit
    if (vicious && isCrit) {
      let viciousVal = 0;

      if (isCompoundDamageDie) {
        const baseFaces = Number(damageDieStr[2]);
        const roll = await new Roll(`2d${baseFaces}`).evaluate({ async: true });
        const results = roll.terms[0].results.map((r) => r.result);
        const tens = results[0];
        const ones = results[1];
        viciousVal = (tens * 10) + ones;
      } else {
        const facesForVicious = damageFaces || primaryFaces;
        const roll = await new Roll(`1d${facesForVicious}`).evaluate({ async: true });
        viciousVal = roll.total;
      }

      total += viciousVal;
      damageBreakdown.push(viciousVal);
    }

    // Sneak
    let sneakText = "";
    if (sneakCount > 0 && sneakFaces) {
      const sneakRoll = await new Roll(`${sneakCount}d${sneakFaces}`).evaluate({ async: true });
      let sneakResults = sneakRoll.terms[0].results.map((r) => r.result);

      if (Number.isFinite(sneakFixed)) {
        let maxIndex = 0;
        let maxVal = sneakResults[0];
        for (let i = 1; i < sneakResults.length; i++) {
          if (sneakResults[i] > maxVal) {
            maxVal = sneakResults[i];
            maxIndex = i;
          }
        }
        // Replace the best die with the fixed value
        sneakResults[maxIndex] = sneakFixed;
      }

      const sneakSum = sneakResults.reduce((a, b) => a + b, 0);
      total += sneakSum;
      sneakText = ` + Sneak(${sneakCount}d${sneakFaces})`;

      // Final per-die faces for DNS
      sneakValues.push(...sneakResults);
    }

    // Weapon Traits: Cheap Shot (1d6), Jousting (1d8), Quick (1d12), Aggressive (1d4)
    let traitsText = "";
    let traitsContribution = 0;
    const traitsPieces = [];

    if (cheapShot) {
      const r = await new Roll("1d6").evaluate({ async: true });
      const val = r.total;
      traitsContribution += val;
      damageBreakdown.push(val);
      traitsPieces.push(`Cheap Shot(1d6=${val})`);
    }

    if (jousting) {
      const r = await new Roll("1d8").evaluate({ async: true });
      const val = r.total;
      traitsContribution += val;
      damageBreakdown.push(val);
      traitsPieces.push(`Jousting(1d8=${val})`);
    }

    if (quick) {
      const r = await new Roll("1d12").evaluate({ async: true });
      const val = r.total;
      traitsContribution += val;
      damageBreakdown.push(val);
      traitsPieces.push(`Quick(1d12=${val})`);
    }

    if (aggressive) {
      const r = await new Roll("1d4").evaluate({ async: true });
      const val = r.total;
      traitsContribution += val;
      damageBreakdown.push(val);
      traitsPieces.push(`Aggressive(1d4=${val})`);
    }

    if (traitsPieces.length) {
      total += traitsContribution;
      traitsText = ` + Traits[${traitsPieces.join(", ")}] (=${traitsContribution})`;
    }

    // Class Pool
    let poolText = "";
    let poolContribution = 0;

    if (poolDiceToUse.length > 0) {
      poolContribution = poolDiceToUse.reduce((a, b) => a + b, 0);
      poolText = ` + Pool[Selected]: ${poolDiceToUse.join(", ")} (=${poolContribution})`;
    } else if (poolSpend > 0 && poolDieFaces) {
      const poolRoll = await new Roll(`${poolSpend}d${poolDieFaces}`).evaluate({ async: true });
      const poolResults = poolRoll.terms[0].results.map((r) => r.result);
      poolContribution = poolResults.reduce((a, b) => a + b, 0);
      poolText = ` + Pool(${poolSpend}d${poolDieFaces})`;
    }

    total += poolContribution;

    // Rage
    let rageText = "";
    let rageContribution = 0;
    if (rageActive && rageDiceValues.length > 0) {
      rageContribution = rageDiceValues.reduce((a, b) => a + b, 0);
      total += rageContribution;
      rageText = ` + Rage[All Stored]: ${rageDiceValues.join(", ")} (=${rageContribution})`;
    }

    // ----- Dice So Nice (synthetic roll matching math) -----
    try {
      if (game.dice3d) {
        const dnsRoll = await this._buildSyntheticDnsRoll({
          primaryFaces,
          primaryBase,
          primaryExtraRolls,
          isCompoundDamageDie,
          damageDieStr,
          damageFaces,
          damageBreakdown,
          // NEW: Sneak for DNS
          sneakFaces,
          sneakValues
        });

        if (dnsRoll) {
          await game.dice3d.showForRoll(dnsRoll, game.user, true);
        } else {
          console.warn("MightyDice: synthetic DNS roll returned null, using fallback.");
          const fallbackRoll = await new Roll(`1d${primaryFaces}`).evaluate({ async: true });
          await game.dice3d.showForRoll(fallbackRoll, game.user, true);
        }
      }
    } catch (err) {
      console.warn("MightyDice: Dice So Nice synthetic animation failed:", err);
    }

    // ----- Chat message -----
    const labelText = cfg.label ? ` for ${cfg.label}` : "";
    const header = `Mighty Dice Roll${labelText}${isCrit ? " — CRITICAL!" : ""}`;

    const advDisText = netAdv === 0
      ? "Normal"
      : netAdv > 0
        ? `Advantage (${netAdv})`
        : `Disadvantage (${Math.abs(netAdv)})`;

    let sneakSummary = "";
    if (sneakCount > 0 && sneakFaces) {
      sneakSummary = `Sneak: ${sneakCount}d${sneakFaces}` +
        (Number.isFinite(sneakFixed) ? ` (one die set to ${sneakFixed})` : "");
    } else {
      sneakSummary = "Sneak: none";
    }

    const storedStr = storedPoolValues.length ? storedPoolValues.join(", ") : "none";
    const poolSummary = `Class Pool: Die=${cfg.poolDie}, Stored=[${storedStr}], SpendSlider=${poolSpend}, Rage=${rageActive ? "ON" : "OFF"}`;

    const traitsSummary = `Traits: Vicious=${vicious ? "ON" : "OFF"}, Cheap Shot=${cheapShot ? "ON" : "OFF"}, Jousting=${jousting ? "ON" : "OFF"}, Quick=${quick ? "ON" : "OFF"}, Aggressive=${aggressive ? "ON" : "OFF"}`;

    const damageList = damageBreakdown.length ? damageBreakdown.join(" + ") : "none";

    let primaryBreakdownText;
    if (primaryExtraRolls.length) {
      primaryBreakdownText = `${primaryBase} + ${primaryExtraRolls.join(" + ")} = ${primaryTotal}`;
    } else {
      primaryBreakdownText = `${primaryTotal}`;
    }

    const headCmSummary = `Head=${headLevel}, Center Mass=${centerMassLevel}`;
    const centerMassLine = centerMassFlavor
      ? `<p><b>Center Mass Effect:</b> ${centerMassFlavor}</p>`
      : "";

    const content = `
      <div class="mighty-dice-result">
        <h2>${header}</h2>
        <p><b>Primary Die:</b> 1 × ${cfg.specialDie} → <b>${primaryBreakdownText}</b>${isCrit ? " (CRIT)" : ""}</p>
        <p><b>Damage Dice:</b> ${numDamageDice} × ${cfg.die} → ${damageList}</p>
        <p><b>Head / Center Mass Levels:</b> ${headCmSummary}</p>
        ${centerMassLine}
        <p><b>Adv/Dis:</b> ${advDisText}</p>
        <p><b>Vicious:</b> ${vicious ? "Yes" : "No"}</p>
        <p><b>${traitsSummary}</b></p>
        <p><b>${sneakSummary}</b></p>
        <p><b>${poolSummary}</b></p>
        <hr>
        <p><b>Total:</b> ${total}${sneakText}${traitsText}${poolText}${rageText}</p>
      </div>
    `;

    const chatData = {
      user: game.user.id,
      speaker,
      content,
      type: CONST.CHAT_MESSAGE_TYPES.ROLL,
      sound: CONFIG.sounds.dice
    };

    await ChatMessage.create(chatData);
  }

  // -----------------------------------------------------------
  // DNS helper: build flattened / synthetic dice
  // -----------------------------------------------------------
  async _buildSyntheticDnsRoll(args) {
    const {
      primaryFaces,
      primaryBase,
      primaryExtraRolls,
      isCompoundDamageDie,
      damageDieStr,
      damageFaces,
      damageBreakdown,
      sneakFaces,
      sneakValues = []
    } = args || {};

    if (!primaryFaces || !Number.isFinite(primaryFaces)) {
      console.warn("MightyDice: _buildSyntheticDnsRoll missing primaryFaces.", args);
      return null;
    }

    // Primary values (base + extra explosions)
    const primaryValues = [];
    if (Number.isFinite(primaryBase)) {
      primaryValues.push(primaryBase);
    } else {
      primaryValues.push(primaryFaces);
    }

    if (Array.isArray(primaryExtraRolls)) {
      for (const v of primaryExtraRolls) {
        if (Number.isFinite(v)) primaryValues.push(v);
      }
    }

    // Damage flattened for DNS
    const damageValuesFlat = [];
    if (Array.isArray(damageBreakdown)) {
      if (!isCompoundDamageDie && damageFaces) {
        for (const v of damageBreakdown) {
          if (Number.isFinite(v)) damageValuesFlat.push(v);
        }
      } else if (isCompoundDamageDie) {
        const baseFaces = Number(damageDieStr?.[2]) || 0;
        if (baseFaces > 0) {
          for (const combined of damageBreakdown) {
            if (!Number.isFinite(combined)) continue;
            let tens = Math.floor(combined / 10);
            let ones = combined % 10;
            if (!Number.isFinite(tens) || tens < 1 || tens > baseFaces) {
              tens = Math.max(1, Math.min(baseFaces, tens || 1));
            }
            if (!Number.isFinite(ones) || ones < 1 || ones > baseFaces) {
              ones = Math.max(1, Math.min(baseFaces, ones || 1));
            }
            damageValuesFlat.push(tens, ones);
          }
        }
      }
    }

    // Sneak dice for DNS
    const sneakValuesFlat = Array.isArray(sneakValues)
      ? sneakValues.filter((v) => Number.isFinite(v))
      : [];
    const totalSneakDice = sneakValuesFlat.length;

    const totalPrimaries = primaryValues.length;
    const totalDamageDice = damageValuesFlat.length;

    if (!totalPrimaries && !totalDamageDice && !totalSneakDice) {
      console.warn("MightyDice: _buildSyntheticDnsRoll had no dice to show.", args);
      return null;
    }

    const parts = [];

    if (totalPrimaries) {
      parts.push(`${totalPrimaries}d${primaryFaces}`);
    }

    if (totalDamageDice) {
      let facesForDamage = damageFaces;

      if (isCompoundDamageDie) {
        facesForDamage = Number(damageDieStr?.[2]) || null;
      } else if (facesForDamage && Array.isArray(damageBreakdown)) {
        // If any damage value exceeds the base faces, assume head overflow → show as d20s
        const anyOverflow = damageBreakdown.some((v) => Number.isFinite(v) && v > facesForDamage);
        if (anyOverflow) {
          facesForDamage = 20;
        }
      }

      if (facesForDamage) {
        parts.push(`${totalDamageDice}d${facesForDamage}`);
      }
    }

    if (totalSneakDice && sneakFaces) {
      parts.push(`${totalSneakDice}d${sneakFaces}`);
    }

    if (!parts.length) {
      console.warn("MightyDice: _buildSyntheticDnsRoll parts empty.", args);
      return null;
    }

    const formula = parts.join(" + ");

    let roll;
    try {
      roll = await new Roll(formula).evaluate({ async: true });
    } catch (err) {
      console.warn("MightyDice: failed to evaluate synthetic DNS formula:", formula, err);
      return null;
    }

    const desiredFaces = [
      ...primaryValues,
      ...damageValuesFlat,
      ...sneakValuesFlat
    ];

    let idx = 0;

    for (const term of roll.terms) {
      if (!term || !term.faces || !Array.isArray(term.results)) continue;
      for (const r of term.results) {
        if (idx >= desiredFaces.length) break;
        const val = desiredFaces[idx++];
        r.result = val;
        r.active = true;
      }
    }

    const totalShown = desiredFaces.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    // In Foundry v13, roll.total is a getter-only property. We don't actually
    // need to override it for Dice So Nice; it just uses the individual results.
    // If you *really* want to store this, _total is still writable:
    roll._total = totalShown;

    return roll;
  }

  // -----------------------------------------------------------
  // Aim for the Head helper
  // -----------------------------------------------------------
  _applyHeadScaling(primaryFaces, headLevel) {
    const ladder = [4, 6, 8, 10, 12, 20];

    if (!Number.isFinite(primaryFaces) || !Number.isFinite(headLevel) || headLevel <= 0) {
      return { primaryFaces, overflowCount: 0 };
    }

    const startIndex = ladder.indexOf(primaryFaces);
    if (startIndex === -1) {
      // If the starting die size isn't on our ladder, don't try to scale it.
      return { primaryFaces, overflowCount: 0 };
    }

    let idx = startIndex;
    let steps = headLevel;
    let overflowCount = 0;

    // Move up the ladder until we hit the top (d20) or run out of steps
    while (steps > 0 && idx < ladder.length - 1) {
      idx++;
      steps--;
    }

    if (steps > 0) {
      // Every extra step beyond the top of the ladder adds +1d20 overflow
      overflowCount = steps;
    }

    return {
      primaryFaces: ladder[idx],
      overflowCount
    };
  }

  // -----------------------------------------------------------
  // Utility helpers
  // -----------------------------------------------------------
  _parseDieFaces(dieStr) {
    if (!dieStr || typeof dieStr !== "string") return null;
    const match = dieStr.match(/d(\d+)/i);
    if (!match) return null;
    const faces = Number(match[1]);
    return Number.isFinite(faces) && faces > 0 ? faces : null;
  }

  _getActor() {
    if (canvas && canvas.tokens && canvas.tokens.controlled.length === 1) {
      return canvas.tokens.controlled[0].actor;
    }
    if (game.user.character) {
      return game.user.character;
    }
    return null;
  }
}

// -----------------------------------------------------------
// Module init / API registration
// -----------------------------------------------------------
Hooks.once("ready", () => {
  const app = new MightyDiceRoller();

  // Expose via module API (for other modules/macros)
  const mod = game.modules.get("mighty-dice-roller");
  if (mod) {
    mod.api = mod.api || {};
    mod.api.app = app;
  }

  // Also expose on global game namespace for convenience
  game.mightyDiceRoller = app;

  // -----------------------------------------------------------
  // Auto-create / update Mighty Dice Roller macro
  // -----------------------------------------------------------
  if (game.user.isGM) {
    const macroName = "Mighty Dice Roller";

    // The macro command we want to ensure exists
    const command = `
if (!game.modules.get("mighty-dice-roller")?.active) {
  ui.notifications.error("Mighty Dice Roller module is not active.");
} else if (!game.mightyDiceRoller) {
  ui.notifications.error("Mighty Dice Roller app is not available.");
} else {
  game.mightyDiceRoller.render(true);
}
    `.trim();

    // Check if macro already exists
    let macro = game.macros.find(m => m.name === macroName);

    if (!macro) {
      // Create the macro
      Macro.create({
        name: macroName,
        type: "script",
        scope: "global",
        command,
        img: "icons/svg/d20.svg"
      }).then(m => {
        // Auto-place on hotbar in slot 1
        game.user.assignHotbarMacro(m, 1);
        console.log("Mighty Dice Roller macro created on hotbar slot 1.");
      });
    } else {
      // Update command if needed
      if (macro.command.trim() !== command.trim()) {
        macro.update({ command });
        console.log("Mighty Dice Roller macro updated.");
      }

      // Ensure macro is on the bar (optional)
      const isOnBar = Object.values(game.user.hotbar).includes(macro.id);
      if (!isOnBar) {
        game.user.assignHotbarMacro(macro, 1);
        console.log("Mighty Dice Roller macro placed on hotbar slot 1.");
      }
    }
  }
});