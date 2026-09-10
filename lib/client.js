window.__ModuleLoader__.load({
	id: "dsh-plugin-deepseek-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		/** Read route served by the host half. Must match ROUTE_PATH in lib/index.js. */
		const ROUTE = "/deepseek-balance";
		/** How often the row re-reads the host's cached snapshot (the child collects every 60s). */
		const REFRESH_MS = 15000;
		/** Currency glyphs; anything else renders as its ISO code. */
		const SYMBOLS = { CNY: "¥", USD: "$", EUR: "€", GBP: "£", JPY: "¥" };

		/**
		 * The sidebar foot is a flex ROW whose only shipped occupant (the Cordis panel row) is
		 * `flex: none; width: 100%`, so a second entry there collapses to zero width. The slot
		 * anchor itself renders with `display: contents`, which is exactly what lets this rule
		 * give the two entries a column of their own without touching the shipped rows.
		 */
		const CSS = [
			'[data-slot="sidebar.footer.action"]{display:flex !important;flex-direction:column;gap:2px;width:100%;min-width:0}',
			".dsb-row{box-sizing:border-box;width:100%;height:42px;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;margin:8px 0 0;padding:0 10px 0 8px;font-family:inherit;font-size:14px;line-height:22px;display:flex;overflow:hidden}",
			".dsb-row:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dsb-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
			".dsb-icon{flex:none;place-items:center;width:16px;height:16px;display:inline-flex;color:var(--dsw-alias-label-secondary)}",
			".dsb-label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}",
			".dsb-value{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;flex:none;margin-left:auto;font-size:12px;line-height:16px}",
			'.dsb-row[data-tone="error"] .dsb-value{color:var(--dsw-alias-state-error-primary)}',
			'.dsb-row[data-busy="true"] .dsb-value{opacity:.7}',
			".dsb-row.dsb-rail{width:36px;height:36px;margin:0;padding:0;justify-content:center;gap:0;border-radius:50%}",
			".dsb-row.dsb-rail .dsb-label,.dsb-row.dsb-rail .dsb-value{display:none}",
			".dsb-railGlyph{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1}",
		].join("");

		function symbolOf(currency) {
			const code = typeof currency === "string" ? currency.toUpperCase() : "";
			if (code === "") return "";
			if (Object.prototype.hasOwnProperty.call(SYMBOLS, code)) return SYMBOLS[code];
			return code + " ";
		}

		function amountOf(entry) {
			return symbolOf(entry.currency) + entry.total;
		}

		/** The entry whose figure stands for the account: the first non-zero one, else the first. */
		function primaryOf(balances) {
			for (let index = 0; index < balances.length; index += 1) {
				const value = Number(balances[index].total);
				if (Number.isFinite(value) && value !== 0) return balances[index];
			}
			return balances.length > 0 ? balances[0] : undefined;
		}

		function timeText(ms) {
			if (typeof ms !== "number" || ms <= 0) return "";
			try {
				return new Date(ms).toLocaleTimeString();
			} catch {
				return "";
			}
		}

		/** A wallet glyph, sized to sit beside the shipped footer rows' marks. */
		function walletGlyph() {
			return React.createElement("svg", {
				width: 16,
				height: 16,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
			}, [
				React.createElement("rect", {
					key: "body",
					x: 1.75,
					y: 3.75,
					width: 12.5,
					height: 8.5,
					rx: 2.25,
					stroke: "currentColor",
					strokeWidth: 1.5,
				}),
				React.createElement("circle", { key: "stud", cx: 11.25, cy: 8, r: 1.25, fill: "currentColor" }),
			]);
		}

		/** The sidebar-foot row: it reads the host snapshot and renders the newest figures. */
		function BalanceRow(props) {
			const wide = props === null || props === undefined || props.wide !== false;
			const [state, setState] = React.useState({
				phase: "loading",
				code: "",
				error: "",
				available: true,
				balances: [],
				fetchedAt: 0,
			});

			const load = () => {
				fetch(ROUTE, { headers: { accept: "application/json" } })
					.then((response) => response.json().then((data) => ({ status: response.status, data })))
					.then(({ status, data }) => {
						const isObject = data !== null && typeof data === "object";
						if (status !== 200 || !isObject || data.ok !== true) {
							const code = isObject && typeof data.code === "string" ? data.code : "http-" + String(status);
							const message = isObject && typeof data.error === "string" ? data.error : "读取失败";
							setState({ phase: "error", code, error: message, available: false, balances: [], fetchedAt: 0 });
							return;
						}
						setState({
							phase: "ok",
							code: "",
							error: "",
							available: data.available === true,
							balances: Array.isArray(data.balances) ? data.balances : [],
							fetchedAt: typeof data.fetchedAt === "number" ? data.fetchedAt : 0,
						});
					})
					.catch((error) => {
						const message = error !== null && error !== undefined && typeof error.message === "string" ? error.message : String(error);
						setState({ phase: "error", code: "network", error: message, available: false, balances: [], fetchedAt: 0 });
					});
			};

			React.useEffect(() => {
				load();
				const id = setInterval(load, REFRESH_MS);
				return () => clearInterval(id);
			}, []);

			const balances = state.balances;
			let tone = "loading";
			let label = "DeepSeek 余额";
			let value = "…";
			let detail = "DeepSeek 余额：正在读取宿主采集进程…";

			if (state.phase === "ok") {
				tone = state.available ? "ok" : "error";
				value = balances.slice(0, 2).map(amountOf).join(" · ");
				const lines = ["DeepSeek 余额（常驻 node 采集）"];
				for (let index = 0; index < balances.length; index += 1) {
					const entry = balances[index];
					lines.push(entry.currency + " " + entry.total + "（赠金 " + entry.granted + " · 充值 " + entry.toppedUp + "）");
				}
				if (state.available !== true) lines.push("该账户当前不可调用");
				const updated = timeText(state.fetchedAt);
				if (updated !== "") lines.push("采集于 " + updated);
				lines.push("node 每 60 秒采集一次 · 界面每 15 秒读取缓存 · 点击立即读取");
				detail = lines.join("\n");
			} else if (state.phase === "error") {
				tone = "error";
				value = state.code === "missing-key" ? "未配置密钥" : "不可用";
				detail = "DeepSeek 余额获取失败\n" + state.error + "\n点击重试 · 每 15 秒自动重试";
			}

			if (wide !== true) {
				const primary = primaryOf(balances);
				const glyph = state.phase === "ok" ? symbolOf(primary === undefined ? "" : primary.currency) : state.phase === "error" ? "!" : "…";
				return React.createElement("button", {
					type: "button",
					className: "dsb-row dsb-rail",
					"data-tone": tone,
					"data-busy": state.phase === "loading" ? "true" : "false",
					title: detail,
					"aria-label": label + " " + value,
					onClick: load,
				}, React.createElement("span", { className: "dsb-railGlyph" }, glyph));
			}

			return React.createElement("button", {
				type: "button",
				className: "dsb-row",
				"data-tone": tone,
				"data-busy": state.phase === "loading" ? "true" : "false",
				title: detail,
				"aria-label": label + " " + value,
				onClick: load,
			}, [
				React.createElement("span", { key: "icon", className: "dsb-icon" }, walletGlyph()),
				React.createElement("span", { key: "label", className: "dsb-label" }, label),
				React.createElement("span", { key: "value", className: "dsb-value" }, value),
			]);
		}

		/** The slot registry is the only client service this half reads. */
		const inject = ["slots"];

		/**
		 * Client plugin body: own the stylesheet and the sidebar-foot row.
		 *
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-plugin-deepseek-balance";
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return () => {
					tag.remove();
				};
			}, "deepseek-balance: styles");
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "deepseek-balance",
				order: 40,
				label: "DeepSeek 余额",
			}, BalanceRow));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
