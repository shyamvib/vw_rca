/* @ds-bundle: {"format":3,"namespace":"DesignSystem_316cce","components":[{"name":"Logo","sourcePath":"components/brand/Logo.jsx"},{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Chip","sourcePath":"components/core/Chip.jsx"},{"name":"DataTable","sourcePath":"components/data/DataTable.jsx"},{"name":"ResultBar","sourcePath":"components/data/ResultBar.jsx"},{"name":"Badge","sourcePath":"components/feedback/Badge.jsx"},{"name":"Modal","sourcePath":"components/feedback/Modal.jsx"},{"name":"NotificationBar","sourcePath":"components/feedback/NotificationBar.jsx"},{"name":"ProgressIndicator","sourcePath":"components/feedback/ProgressIndicator.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"ToastStack","sourcePath":"components/feedback/Toast.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"DatePicker","sourcePath":"components/forms/DatePicker.jsx"},{"name":"FileUploader","sourcePath":"components/forms/FileUploader.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"MultiSelect","sourcePath":"components/forms/MultiSelect.jsx"},{"name":"NumberInput","sourcePath":"components/forms/NumberInput.jsx"},{"name":"PhoneInput","sourcePath":"components/forms/PhoneInput.jsx"},{"name":"Radio","sourcePath":"components/forms/Radio.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"},{"name":"Icon","sourcePath":"components/icons/Icon.jsx"},{"name":"Accordion","sourcePath":"components/navigation/Accordion.jsx"},{"name":"Breadcrumb","sourcePath":"components/navigation/Breadcrumb.jsx"},{"name":"Menu","sourcePath":"components/navigation/Menu.jsx"},{"name":"Pagination","sourcePath":"components/navigation/Pagination.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/brand/Logo.jsx":"20b0ed92cfd0","components/core/Avatar.jsx":"0882230273b6","components/core/Button.jsx":"91da56d87fd4","components/core/Card.jsx":"72e8969fd212","components/core/Chip.jsx":"b11ae5e2a970","components/data/DataTable.jsx":"9432219e8e31","components/data/ResultBar.jsx":"a517d8f46dd0","components/feedback/Badge.jsx":"edaa5a0b7872","components/feedback/Modal.jsx":"7cc3a5276563","components/feedback/NotificationBar.jsx":"e0d49d561720","components/feedback/ProgressIndicator.jsx":"f97a6d666daf","components/feedback/Toast.jsx":"64a8c2223f54","components/feedback/Tooltip.jsx":"ce56356580df","components/forms/Checkbox.jsx":"7b6b394be53c","components/forms/DatePicker.jsx":"d6331e238079","components/forms/FileUploader.jsx":"073b339d99e1","components/forms/Input.jsx":"b27940e88c2e","components/forms/MultiSelect.jsx":"d83854c2d8b2","components/forms/NumberInput.jsx":"99171e4c229c","components/forms/PhoneInput.jsx":"e59042ee5f70","components/forms/Radio.jsx":"9a5fbdb9ba48","components/forms/Select.jsx":"e160bb85e5e1","components/forms/Switch.jsx":"1677521c2ce7","components/forms/Textarea.jsx":"c368b918099c","components/icons/Icon.jsx":"277960aad9ba","components/navigation/Accordion.jsx":"36f99ff9baf8","components/navigation/Breadcrumb.jsx":"c53e0b6da1fc","components/navigation/Menu.jsx":"102e93271ef7","components/navigation/Pagination.jsx":"15234a32cb08","components/navigation/Tabs.jsx":"ecd57cde15ad","ui_kits/lab_report/DiversityPanel.jsx":"d618bed4773c","ui_kits/lab_report/MarkerTable.jsx":"ccc0556fbf02","ui_kits/lab_report/data.js":"60c0b7f9e6a6"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.DesignSystem_316cce = window.DesignSystem_316cce || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/brand/Logo.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Official Vibrant lockup (brandmark + "VIBRANT" wordmark), supplied by the brand.
// Recolored to currentColor so `tone` controls ink vs white. viewBox 0 0 548.25 81.
const LOCKUP_INNER = `<defs><clipPath id="b13f8a7522"><path d="M 63.722656 2 L 130 2 L 130 60.625 L 63.722656 60.625 Z M 63.722656 2 " clip-rule="nonzero"></path></clipPath><clipPath id="08e58906d1"><path d="M 89 0.0546875 L 104 0.0546875 L 104 14 L 89 14 Z M 89 0.0546875 " clip-rule="nonzero"></path></clipPath><clipPath id="973f34f140"><path d="M 444 7 L 475.660156 7 L 475.660156 54 L 444 54 Z M 444 7 " clip-rule="nonzero"></path></clipPath></defs><g clip-path="url(#b13f8a7522)"><path fill="currentColor" d="M 119.632812 2.207031 C 115.054688 2.207031 111.203125 5.226562 109.980469 9.390625 C 109.789062 10.023438 106.75 19.992188 96.574219 19.992188 C 86.394531 19.992188 83.59375 9.707031 83.484375 9.375 C 82.242188 5.226562 78.394531 2.207031 73.828125 2.207031 C 68.261719 2.207031 63.746094 6.699219 63.746094 12.238281 C 63.746094 17.777344 68.261719 22.269531 73.828125 22.269531 C 74.925781 22.269531 75.976562 22.097656 76.960938 21.765625 C 77.582031 21.605469 87.492188 19.1875 92.230469 27.777344 C 96.605469 35.738281 90.097656 42.828125 90.097656 42.828125 L 90.113281 42.828125 C 87.90625 44.664062 86.488281 47.433594 86.488281 50.519531 C 86.488281 56.054688 91.003906 60.550781 96.574219 60.550781 C 102.140625 60.550781 106.65625 56.054688 106.65625 50.519531 C 106.65625 47.433594 105.257812 44.664062 103.03125 42.828125 C 103.03125 42.828125 95.9375 36.386719 100.914062 27.777344 C 105.398438 20.023438 115.179688 21.542969 117.089844 21.921875 C 117.902344 22.128906 118.742188 22.253906 119.632812 22.253906 C 125.203125 22.253906 129.71875 17.761719 129.71875 12.222656 C 129.71875 6.683594 125.203125 2.191406 119.632812 2.191406 " fill-opacity="1" fill-rule="nonzero"></path></g><g clip-path="url(#08e58906d1)"><path fill="currentColor" d="M 96.730469 -0.0429688 C 100.550781 -0.0429688 103.632812 3.042969 103.632812 6.828125 C 103.632812 10.609375 100.550781 13.710938 96.730469 13.710938 C 92.914062 13.710938 89.828125 10.625 89.828125 6.828125 C 89.828125 3.027344 92.914062 -0.0429688 96.730469 -0.0429688 Z M 96.730469 -0.0429688 " fill-opacity="1" fill-rule="nonzero"></path></g><path fill="currentColor" d="M 112.476562 27.082031 C 116.292969 27.082031 119.378906 30.167969 119.378906 33.949219 C 119.378906 37.730469 116.292969 40.832031 112.476562 40.832031 C 108.660156 40.832031 105.574219 37.746094 105.574219 33.949219 C 105.574219 30.152344 108.660156 27.082031 112.476562 27.082031 Z M 112.476562 27.082031 " fill-opacity="1" fill-rule="nonzero"></path><path fill="currentColor" d="M 80.730469 27.082031 C 84.546875 27.082031 87.632812 30.167969 87.632812 33.949219 C 87.632812 37.730469 84.546875 40.832031 80.730469 40.832031 C 76.914062 40.832031 73.828125 37.746094 73.828125 33.949219 C 73.828125 30.152344 76.914062 27.082031 80.730469 27.082031 Z M 80.730469 27.082031 " fill-opacity="1" fill-rule="nonzero"></path><path fill="currentColor" d="M 170.253906 7.84375 L 175.320312 7.84375 L 184.929688 33.285156 C 186.011719 36.046875 187.074219 38.832031 188.113281 41.636719 C 188.890625 43.667969 189.671875 45.695312 190.449219 47.722656 L 190.386719 47.722656 C 191.382812 45.21875 192.355469 42.71875 193.308594 40.214844 C 194.042969 38.3125 194.976562 35.941406 196.101562 33.089844 L 205.710938 7.84375 L 210.710938 7.84375 L 193.113281 53.160156 L 187.527344 53.160156 Z M 170.253906 7.84375 " fill-opacity="1" fill-rule="nonzero"></path><path fill="currentColor" d="M 224.4375 7.84375 L 229.308594 7.84375 L 229.308594 53.160156 L 224.4375 53.160156 Z M 224.4375 7.84375 " fill-opacity="1" fill-rule="nonzero"></path><path fill="currentColor" d="M 248.5625 7.84375 L 262.65625 7.84375 C 265.597656 7.84375 268.175781 8.316406 270.382812 9.265625 C 272.589844 10.171875 274.300781 11.511719 275.515625 13.28125 C 276.726562 15.007812 277.332031 17.078125 277.332031 19.496094 C 277.332031 21.4375 276.878906 23.1875 275.96875 24.738281 C 275.058594 26.292969 273.804688 27.546875 272.203125 28.496094 C 270.644531 29.445312 268.890625 29.960938 266.941406 30.050781 L 267.460938 29.53125 C 269.367188 29.660156 271.164062 30.179688 272.851562 31.085938 C 274.582031 31.992188 275.96875 33.285156 277.007812 34.96875 C 278.089844 36.609375 278.632812 38.53125 278.632812 40.730469 C 278.632812 43.277344 277.9375 45.5 276.554688 47.398438 C 275.210938 49.257812 273.347656 50.679688 270.96875 51.671875 C 268.628906 52.664062 265.96875 53.160156 262.980469 53.160156 L 248.5625 53.160156 Z M 262.460938 28.042969 C 265.578125 28.042969 268.003906 27.328125 269.734375 25.90625 C 271.507812 24.480469 272.398438 22.515625 272.398438 20.015625 C 272.398438 17.207031 271.488281 15.15625 269.667969 13.863281 C 267.894531 12.523438 265.382812 11.855469 262.136719 11.855469 L 251.289062 11.855469 L 253.433594 9.65625 L 253.433594 51.285156 L 251.289062 49.148438 L 262.460938 49.148438 C 266.054688 49.148438 268.804688 48.394531 270.707031 46.882812 C 272.65625 45.328125 273.628906 43.171875 273.628906 40.40625 C 273.628906 37.773438 272.65625 35.703125 270.707031 34.191406 C 268.804688 32.683594 266.054688 31.925781 262.460938 31.925781 L 252.589844 31.925781 L 252.589844 28.042969 Z M 262.460938 28.042969 " fill-opacity="1" fill-rule="nonzero"></path><path fill="currentColor" d="M 295.265625 7.84375 L 311.175781 7.84375 C 314.511719 7.84375 317.390625 8.382812 319.8125 9.460938 C 322.238281 10.496094 324.078125 11.984375 325.335938 13.929688 C 326.632812 15.828125 327.28125 18.070312 327.28125 20.660156 C 327.28125 23.121094 326.589844 25.324219 325.203125 27.265625 C 323.863281 29.164062 321.957031 30.652344 319.488281 31.730469 C 317.066406 32.769531 314.25 33.285156 311.046875 33.285156 L 299.292969 33.285156 L 299.292969 29.273438 L 310.65625 29.273438 C 314.207031 29.273438 317.019531 28.539062 319.097656 27.070312 C 321.222656 25.558594 322.28125 23.421875 322.28125 20.660156 C 322.28125 17.726562 321.265625 15.546875 319.230469 14.121094 C 317.238281 12.65625 314.421875 11.921875 310.789062 11.921875 L 298.96875 11.921875 L 300.136719 10.753906 L 300.136719 53.160156 L 295.265625 53.160156 Z M 306.695312 31.539062 L 312.152344 31.539062 L 328.582031 53.160156 L 322.738281 53.160156 Z M 306.695312 31.539062 " fill-opacity="1" fill-rule="nonzero"></path><path fill="currentColor" d="M 356.273438 7.84375 L 361.921875 7.84375 L 379.390625 53.160156 L 374.195312 53.160156 L 363.546875 24.871094 C 361.855469 20.46875 360.34375 16.453125 359 12.828125 C 357.484375 16.753906 355.925781 20.832031 354.324219 25.0625 L 343.542969 53.160156 L 338.414062 53.160156 Z M 347.699219 38.011719 L 369.976562 38.011719 L 372.25 42.21875 L 345.230469 42.21875 Z M 347.699219 38.011719 " fill-opacity="1" fill-rule="nonzero"></path><path fill="currentColor" d="M 393.238281 7.84375 L 399.472656 7.84375 L 426.035156 49.019531 L 424.929688 49.277344 C 424.757812 45.046875 424.671875 39.652344 424.671875 33.089844 L 424.671875 7.84375 L 429.476562 7.84375 L 429.476562 53.160156 L 423.304688 53.160156 L 396.679688 11.984375 L 397.785156 11.726562 C 398 17.898438 398.109375 23.1875 398.109375 27.589844 L 398.109375 53.160156 L 393.238281 53.160156 Z M 393.238281 7.84375 " fill-opacity="1" fill-rule="nonzero"></path><g clip-path="url(#973f34f140)"><path fill="currentColor" d="M 457.328125 11.078125 L 458.496094 12.246094 L 444.015625 12.246094 L 444.015625 7.84375 L 475.449219 7.84375 L 475.449219 12.246094 L 461.03125 12.246094 L 462.199219 11.078125 L 462.199219 53.160156 L 457.328125 53.160156 Z M 457.328125 11.078125 " fill-opacity="1" fill-rule="nonzero"></path></g>`;

/**
 * Vibrant logo. `variant`:
 *  - lockup (default) = official brandmark + wordmark SVG
 *  - brandmark        = molecular mark only
 *  - wordmark         = "VIBRANT" set in the brand wordmark proportions
 * `tone`: ink (default) for light backgrounds, white for dark / brand-color.
 * `height` sizes the mark / cap height in px.
 */
function Logo({
  variant = 'lockup',
  tone = 'ink',
  height = 32,
  style,
  ...rest
}) {
  const color = tone === 'white' ? 'var(--vw-white)' : 'var(--vw-ink)';
  if (variant === 'lockup') {
    // lockup aspect ratio 548.25 : 81  ->  width derived from height
    const w = 548.25 / 81 * height;
    return /*#__PURE__*/React.createElement("span", _extends({
      role: "img",
      "aria-label": "Vibrant",
      style: {
        display: 'inline-flex',
        color,
        ...style
      }
    }, rest), /*#__PURE__*/React.createElement("svg", {
      viewBox: "0 0 548.25 81",
      height: height,
      width: w,
      style: {
        display: 'block'
      },
      dangerouslySetInnerHTML: {
        __html: LOCKUP_INNER
      }
    }));
  }
  const mark = /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 200 210",
    height: height,
    fill: color,
    "aria-hidden": "true",
    style: {
      display: 'block',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M100 52c24 0 40 16 40 40 0 13-6 24-16 31l-1 .6c14 7 23 21 23 38 0 26-20 44-46 44s-46-18-46-44c0-17 9-31 24-38l-1-.6c-10-7-16-18-16-31 0-24 15-40 39-40z"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "100",
    cy: "40",
    r: "22"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "52",
    cy: "108",
    r: "22"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "148",
    cy: "108",
    r: "22"
  }));
  const wordmark = /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontWeight: 'var(--fw-light)',
      fontSize: height * 0.82,
      letterSpacing: '0.22em',
      color,
      lineHeight: 1,
      paddingLeft: '0.22em'
    }
  }, "VIBRANT");
  return /*#__PURE__*/React.createElement("span", _extends({
    role: "img",
    "aria-label": "Vibrant",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: height * 0.5,
      ...style
    }
  }, rest), variant === 'brandmark' && mark, variant === 'wordmark' && wordmark);
}
Object.assign(__ds_scope, { Logo });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/Logo.jsx", error: String((e && e.message) || e) }); }

// components/core/Avatar.jsx
try { (() => {
/** Vibrant avatar — initials or image, circle or square. */
function Avatar({
  src,
  name = '',
  size = 36,
  shape = 'circle',
  style
}) {
  const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: size,
      flexShrink: 0,
      borderRadius: shape === 'circle' ? '50%' : 'var(--radius-sm)',
      background: src ? `center/cover url(${src})` : 'var(--vw-blue-tint)',
      color: 'var(--vw-blue)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-sans)',
      fontSize: size * 0.38,
      fontWeight: 600,
      overflow: 'hidden',
      ...style
    }
  }, !src && initials);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Vibrant Button. Primary (filled blue), secondary (filled neutral),
 * outlined, and text usages. Hover = subtle tint, press = deeper tint.
 * Radius is square (4px) by default; `pill` rounds to a capsule (brand-book
 * marketing style). Label sets in mono uppercase for the eyebrow-button look,
 * or sans for app UI via `case="sentence"`.
 */
function Button({
  children,
  usage = 'primary',
  size = 'md',
  tone = 'blue',
  pill = false,
  casing = 'mono',
  disabled = false,
  iconLeft,
  iconRight,
  style,
  ...rest
}) {
  const sizes = {
    sm: {
      h: 32,
      px: 14,
      fs: 13
    },
    md: {
      h: 40,
      px: 18,
      fs: 14
    },
    lg: {
      h: 48,
      px: 24,
      fs: 15
    }
  }[size];
  const toneColor = {
    blue: 'var(--vw-blue)',
    dark: 'var(--vw-blue-press)',
    red: 'var(--vw-error)'
  }[tone];
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: sizes.h,
    padding: `0 ${sizes.px}px`,
    fontFamily: casing === 'mono' ? 'var(--font-mono)' : 'var(--font-sans)',
    fontWeight: casing === 'mono' ? 400 : 500,
    fontSize: sizes.fs,
    letterSpacing: casing === 'mono' ? '0.06em' : '0',
    textTransform: casing === 'mono' ? 'uppercase' : 'none',
    borderRadius: pill ? 999 : 'var(--radius-sm)',
    border: '1.5px solid transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast)',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    lineHeight: 1
  };
  const variants = {
    primary: {
      background: toneColor,
      color: 'var(--vw-white)',
      borderColor: toneColor
    },
    secondary: {
      background: 'var(--vw-ink)',
      color: 'var(--vw-white)',
      borderColor: 'var(--vw-ink)'
    },
    outlined: {
      background: 'transparent',
      color: toneColor,
      borderColor: toneColor
    },
    text: {
      background: 'transparent',
      color: toneColor,
      borderColor: 'transparent',
      padding: `0 ${sizes.px - 8}px`
    }
  };
  const disabledStyle = disabled ? {
    background: usage === 'primary' || usage === 'secondary' ? 'var(--vw-gray-15)' : 'transparent',
    color: 'var(--vw-text-disabled, var(--vw-gray-40))',
    borderColor: usage === 'outlined' ? 'var(--vw-gray-20)' : 'transparent'
  } : null;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    style: {
      ...base,
      ...variants[usage],
      ...disabledStyle,
      ...style
    },
    onMouseEnter: e => {
      if (!disabled && usage !== 'primary' && usage !== 'secondary') e.currentTarget.style.background = tone === 'red' ? 'rgba(209,0,0,0.05)' : 'rgba(1,66,226,0.05)';
    },
    onMouseLeave: e => {
      if (!disabled && usage !== 'primary' && usage !== 'secondary') e.currentTarget.style.background = 'transparent';
    }
  }, rest), iconLeft, children, iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Vibrant card — white surface, hairline border, soft shadow, square-ish radius. */
function Card({
  children,
  padding = 24,
  interactive = false,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-sm)',
      padding,
      transition: interactive ? 'box-shadow var(--dur-base), transform var(--dur-base)' : 'none',
      cursor: interactive ? 'pointer' : 'default',
      ...style
    },
    onMouseEnter: interactive ? e => {
      e.currentTarget.style.boxShadow = 'var(--shadow-md)';
    } : undefined,
    onMouseLeave: interactive ? e => {
      e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
    } : undefined
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Chip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Vibrant chip — pill or square. Removable (×) and selectable variants, with a
 * leading dot/avatar slot. Used for filters, selected values, and tags.
 */
function Chip({
  children,
  shape = 'pill',
  color = 'neutral',
  selected = false,
  onRemove,
  leading,
  size = 'md',
  style,
  ...rest
}) {
  const dims = {
    sm: {
      h: 24,
      px: 10,
      fs: 12
    },
    md: {
      h: 28,
      px: 12,
      fs: 13
    }
  }[size];
  const palette = {
    neutral: {
      bg: 'var(--vw-gray-05)',
      fg: 'var(--text-primary)',
      border: 'var(--border-subtle)'
    },
    blue: {
      bg: 'var(--vw-blue-tint)',
      fg: 'var(--vw-blue)',
      border: 'var(--blue-w-30, #b3c6f6)'
    }
  }[color];
  const sel = selected ? {
    background: 'var(--vw-blue)',
    color: 'white',
    borderColor: 'var(--vw-blue)'
  } : {};
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: dims.h,
      padding: `0 ${dims.px}px`,
      borderRadius: shape === 'pill' ? 999 : 'var(--radius-sm)',
      background: palette.bg,
      color: palette.fg,
      border: `1px solid ${palette.border}`,
      fontFamily: 'var(--font-sans)',
      fontSize: dims.fs,
      fontWeight: 500,
      ...sel,
      ...style
    }
  }, rest), leading, children, onRemove && /*#__PURE__*/React.createElement("button", {
    onClick: onRemove,
    "aria-label": "Remove",
    style: {
      border: 'none',
      background: 'none',
      cursor: 'pointer',
      color: 'inherit',
      padding: 0,
      lineHeight: 0,
      opacity: 0.7
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 16 16",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 4l8 8M12 4l-8 8",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round"
  }))));
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Chip.jsx", error: String((e && e.message) || e) }); }

// components/data/DataTable.jsx
try { (() => {
/**
 * Vibrant data table / repeater. Mono uppercase header row with optional
 * sortable affiliation, hairline row dividers, hover highlight, and a selected
 * row state. Columns: [{ key, header, width, align, render }].
 */
function DataTable({
  columns = [],
  rows = [],
  sort,
  onSort,
  selectedKey,
  onRowClick,
  rowKey = 'id',
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      ...style
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: 'var(--vw-gray-02)'
    }
  }, columns.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.key,
    onClick: () => c.sortable && onSort && onSort(c.key),
    style: {
      textAlign: c.align || 'left',
      padding: '11px 14px',
      width: c.width,
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      letterSpacing: '.05em',
      textTransform: 'uppercase',
      fontWeight: 400,
      color: 'var(--text-tertiary)',
      cursor: c.sortable ? 'pointer' : 'default',
      userSelect: 'none',
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5
    }
  }, c.header, c.sortable && /*#__PURE__*/React.createElement("span", {
    style: {
      color: sort && sort.key === c.key ? 'var(--vw-blue)' : 'var(--vw-gray-30)'
    }
  }, sort && sort.key === c.key && sort.dir === 'desc' ? '▼' : '▲')))))), /*#__PURE__*/React.createElement("tbody", null, rows.map((r, i) => {
    const k = r[rowKey] ?? i;
    const isSel = k === selectedKey;
    return /*#__PURE__*/React.createElement("tr", {
      key: k,
      onClick: () => onRowClick && onRowClick(r),
      style: {
        background: isSel ? 'var(--vw-blue-tint)' : 'var(--vw-white)',
        cursor: onRowClick ? 'pointer' : 'default',
        borderBottom: i < rows.length - 1 ? '1px solid var(--border-subtle)' : 'none'
      },
      onMouseEnter: e => {
        if (!isSel && onRowClick) e.currentTarget.style.background = 'var(--vw-gray-02)';
      },
      onMouseLeave: e => {
        if (!isSel && onRowClick) e.currentTarget.style.background = 'var(--vw-white)';
      }
    }, columns.map(c => /*#__PURE__*/React.createElement("td", {
      key: c.key,
      style: {
        textAlign: c.align || 'left',
        padding: '12px 14px',
        fontSize: 14,
        color: 'var(--text-primary)'
      }
    }, c.render ? c.render(r[c.key], r) : r[c.key])));
  }))));
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/data/ResultBar.jsx
try { (() => {
/**
 * Vibrant ResultBar — the signature lab-report range visualization. A
 * horizontal bar split into colored reference zones (in-control / moderate /
 * high-risk) with tick labels, and a teal pin marking the patient's current
 * value. Drives every Vibrant test panel (Gut Zoomer, Micronutrient, etc).
 *
 * `zones`: [{ to: number, color }] left→right, each ending at `to` on the scale.
 * `ticks`: numeric boundary labels to print under the bar.
 */
function ResultBar({
  min = 0,
  max = 100,
  value,
  zones = [],
  ticks = [],
  width = '100%',
  style
}) {
  const pct = n => `${Math.max(0, Math.min(100, (n - min) / (max - min) * 100))}%`;
  const colorFor = c => ({
    green: 'var(--vw-result-in-control)',
    amber: 'var(--vw-result-moderate)',
    red: 'var(--vw-result-high-risk)'
  })[c] || c;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width,
      fontFamily: 'var(--font-mono)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      height: 10,
      borderRadius: 999,
      overflow: 'visible',
      display: 'flex'
    }
  }, zones.map((z, i) => {
    const start = i === 0 ? min : zones[i - 1].to;
    const w = (z.to - start) / (max - min) * 100;
    return /*#__PURE__*/React.createElement("span", {
      key: i,
      style: {
        width: `${w}%`,
        background: colorFor(z.color),
        height: '100%',
        borderTopLeftRadius: i === 0 ? 999 : 0,
        borderBottomLeftRadius: i === 0 ? 999 : 0,
        borderTopRightRadius: i === zones.length - 1 ? 999 : 0,
        borderBottomRightRadius: i === zones.length - 1 ? 999 : 0
      }
    });
  }), value != null && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: -8,
      left: pct(value),
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 14,
      height: 14,
      borderRadius: '50% 50% 50% 0',
      transform: 'rotate(45deg)',
      background: 'var(--vw-result-marker)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.25)'
    }
  }))), ticks.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      height: 16,
      marginTop: 4
    }
  }, ticks.map((t, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      position: 'absolute',
      left: pct(t),
      transform: 'translateX(-50%)',
      fontSize: 11,
      color: 'var(--text-tertiary)'
    }
  }, t))));
}
Object.assign(__ds_scope, { ResultBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/ResultBar.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Vibrant badge / status pill. Solid or soft fills across the semantic and
 * brand palette. Mono label option for clinical-style tags.
 */
function Badge({
  children,
  color = 'neutral',
  variant = 'soft',
  size = 'md',
  mono = false,
  style,
  ...rest
}) {
  const palette = {
    neutral: {
      solid: 'var(--vw-ink)',
      soft: 'var(--vw-gray-10)',
      softText: 'var(--vw-gray-80)'
    },
    blue: {
      solid: 'var(--vw-blue)',
      soft: 'var(--vw-blue-tint)',
      softText: 'var(--vw-blue)'
    },
    success: {
      solid: 'var(--vw-success)',
      soft: 'var(--vw-success-bg)',
      softText: 'var(--vw-success)'
    },
    warning: {
      solid: 'var(--vw-warning)',
      soft: 'var(--vw-warning-bg)',
      softText: 'var(--kahki-b-50, #795b35)'
    },
    error: {
      solid: 'var(--vw-error)',
      soft: 'var(--vw-error-bg)',
      softText: 'var(--vw-error)'
    }
  }[color];
  const dims = {
    sm: {
      h: 18,
      px: 7,
      fs: 11
    },
    md: {
      h: 22,
      px: 9,
      fs: 12
    },
    lg: {
      h: 26,
      px: 11,
      fs: 13
    }
  }[size];
  const styles = variant === 'solid' ? {
    background: palette.solid,
    color: 'var(--vw-white)'
  } : {
    background: palette.soft,
    color: palette.softText
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      height: dims.h,
      padding: `0 ${dims.px}px`,
      borderRadius: 'var(--radius-xs)',
      fontSize: dims.fs,
      lineHeight: 1,
      fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
      fontWeight: mono ? 400 : 500,
      letterSpacing: mono ? '0.04em' : '0',
      textTransform: mono ? 'uppercase' : 'none',
      ...styles,
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Badge.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Modal.jsx
try { (() => {
/**
 * Vibrant modal / dialog. Centered card on a dimmed scrim, header with title +
 * close, body, and a right-aligned footer action row.
 */
function Modal({
  open,
  title,
  children,
  footer,
  onClose,
  width = 480
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 100,
      background: 'rgba(22,22,22,0.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    role: "dialog",
    "aria-modal": "true",
    style: {
      width: '100%',
      maxWidth: width,
      background: 'var(--vw-white)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-lg)',
      overflow: 'hidden',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '18px 22px',
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontSize: 18,
      fontWeight: 600,
      color: 'var(--text-primary)'
    }
  }, title), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    "aria-label": "Close",
    style: {
      border: 'none',
      background: 'none',
      cursor: 'pointer',
      color: 'var(--text-tertiary)',
      padding: 4,
      lineHeight: 0
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 16 16",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 4l8 8M12 4l-8 8",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '22px',
      fontSize: 15,
      color: 'var(--text-secondary)',
      lineHeight: 1.5
    }
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 10,
      padding: '16px 22px',
      borderTop: '1px solid var(--border-subtle)',
      background: 'var(--vw-gray-02)'
    }
  }, footer)));
}
Object.assign(__ds_scope, { Modal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Modal.jsx", error: String((e && e.message) || e) }); }

// components/feedback/NotificationBar.jsx
try { (() => {
/**
 * Vibrant notification bar. Inline banner for info / success / warning / error
 * messaging. Left status rule, optional title, optional dismiss.
 */
function NotificationBar({
  status = 'info',
  title,
  children,
  onDismiss,
  style
}) {
  const map = {
    info: {
      bg: 'var(--vw-info-bg)',
      rule: 'var(--vw-blue)'
    },
    success: {
      bg: 'var(--vw-success-bg)',
      rule: 'var(--vw-success)'
    },
    warning: {
      bg: 'var(--vw-warning-bg)',
      rule: 'var(--vw-warning)'
    },
    error: {
      bg: 'var(--vw-error-bg)',
      rule: 'var(--vw-error)'
    }
  }[status];
  return /*#__PURE__*/React.createElement("div", {
    role: "status",
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: '12px 14px',
      background: map.bg,
      borderLeft: `3px solid ${map.rule}`,
      borderRadius: 'var(--radius-sm)',
      fontFamily: 'var(--font-sans)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: map.rule,
      marginTop: 7,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--text-primary)',
      marginBottom: 2
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: 'var(--text-secondary)',
      lineHeight: 1.45
    }
  }, children)), onDismiss && /*#__PURE__*/React.createElement("button", {
    onClick: onDismiss,
    "aria-label": "Dismiss",
    style: {
      border: 'none',
      background: 'none',
      cursor: 'pointer',
      color: 'var(--text-tertiary)',
      padding: 2,
      lineHeight: 0
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 16 16",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 4l8 8M12 4l-8 8",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round"
  }))));
}
Object.assign(__ds_scope, { NotificationBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/NotificationBar.jsx", error: String((e && e.message) || e) }); }

// components/feedback/ProgressIndicator.jsx
try { (() => {
/**
 * Vibrant progress indicator — horizontal stepper. Steps show complete /
 * current / upcoming states with mono step numbers and a connecting rule.
 */
function ProgressIndicator({
  steps = [],
  current = 0,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      width: '100%',
      ...style
    }
  }, steps.map((label, i) => {
    const done = i < current,
      active = i === current;
    const color = done ? 'var(--vw-blue)' : active ? 'var(--vw-blue)' : 'var(--vw-gray-30)';
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: i
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
        width: 96
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 28,
        height: 28,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: done ? 'var(--vw-blue)' : 'var(--vw-white)',
        border: `1.5px solid ${color}`,
        color: done ? 'white' : color,
        fontFamily: 'var(--font-mono)',
        fontSize: 12
      }
    }, done ? /*#__PURE__*/React.createElement("svg", {
      width: "13",
      height: "13",
      viewBox: "0 0 16 16",
      fill: "none"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M3 8.5l3.2 3.2L13 5",
      stroke: "white",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    })) : String(i + 1).padStart(2, '0')), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        textAlign: 'center',
        color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
        fontWeight: active ? 600 : 400
      }
    }, label)), i < steps.length - 1 && /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        height: 1.5,
        background: i < current ? 'var(--vw-blue)' : 'var(--vw-gray-20)',
        marginTop: 13
      }
    }));
  }));
}
Object.assign(__ds_scope, { ProgressIndicator });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/ProgressIndicator.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
/**
 * Vibrant toast — transient floating notification. Render a <ToastStack> at the
 * app root and push messages, or drop a single <Toast> for a static demo.
 */
function Toast({
  status = 'info',
  title,
  children,
  onDismiss,
  style
}) {
  const map = {
    info: 'var(--vw-blue)',
    success: 'var(--vw-success)',
    warning: 'var(--vw-warning)',
    error: 'var(--vw-error)'
  }[status];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      minWidth: 280,
      maxWidth: 380,
      padding: '14px 16px',
      background: 'var(--vw-ink)',
      color: 'var(--vw-paper)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-lg)',
      fontFamily: 'var(--font-sans)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: map,
      marginTop: 6,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600
    }
  }, title), children && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'rgba(243,243,243,.75)',
      marginTop: title ? 2 : 0,
      lineHeight: 1.45
    }
  }, children)), onDismiss && /*#__PURE__*/React.createElement("button", {
    onClick: onDismiss,
    "aria-label": "Dismiss",
    style: {
      border: 'none',
      background: 'none',
      cursor: 'pointer',
      color: 'rgba(243,243,243,.6)',
      padding: 0,
      lineHeight: 0
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "15",
    viewBox: "0 0 16 16",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 4l8 8M12 4l-8 8",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round"
  }))));
}

/** Fixed bottom-right stack container for toasts. */
function ToastStack({
  children,
  position = 'bottom-right'
}) {
  const pos = {
    'bottom-right': {
      bottom: 20,
      right: 20
    },
    'bottom-left': {
      bottom: 20,
      left: 20
    },
    'top-right': {
      top: 20,
      right: 20
    },
    'top-left': {
      top: 20,
      left: 20
    }
  }[position];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      zIndex: 200,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      ...pos
    }
  }, children);
}
Object.assign(__ds_scope, { Toast, ToastStack });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
/** Vibrant tooltip — dark ink bubble, optional arrow. Hover-wrapped. */
function Tooltip({
  content,
  placement = 'top',
  children
}) {
  const [show, setShow] = React.useState(false);
  const pos = {
    top: {
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginBottom: 8
    },
    bottom: {
      top: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginTop: 8
    },
    left: {
      right: '100%',
      top: '50%',
      transform: 'translateY(-50%)',
      marginRight: 8
    },
    right: {
      left: '100%',
      top: '50%',
      transform: 'translateY(-50%)',
      marginLeft: 8
    }
  }[placement];
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex'
    },
    onMouseEnter: () => setShow(true),
    onMouseLeave: () => setShow(false)
  }, children, show && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      zIndex: 40,
      ...pos,
      whiteSpace: 'nowrap',
      background: 'var(--vw-ink)',
      color: 'var(--vw-white)',
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      lineHeight: 1.4,
      padding: '6px 10px',
      borderRadius: 'var(--radius-sm)',
      boxShadow: 'var(--shadow-md)',
      maxWidth: 240,
      whiteSpace: 'normal'
    }
  }, content));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Vibrant checkbox — square 2px corners, blue fill when checked. */
function Checkbox({
  checked = false,
  indeterminate = false,
  label,
  disabled = false,
  onChange,
  size = 'md',
  ...rest
}) {
  const d = {
    sm: 16,
    md: 18,
    lg: 20
  }[size];
  const on = checked || indeterminate;
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      fontFamily: 'var(--font-sans)',
      fontSize: 15,
      color: 'var(--text-primary)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: d,
      height: d,
      borderRadius: 'var(--radius-xs)',
      flexShrink: 0,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: on ? 'var(--vw-blue)' : 'var(--vw-white)',
      border: `1.5px solid ${on ? 'var(--vw-blue)' : 'var(--border-strong)'}`,
      transition: 'all var(--dur-fast)'
    }
  }, checked && !indeterminate && /*#__PURE__*/React.createElement("svg", {
    width: d * 0.62,
    height: d * 0.62,
    viewBox: "0 0 16 16",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M3 8.5l3.2 3.2L13 5",
    stroke: "white",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })), indeterminate && /*#__PURE__*/React.createElement("span", {
    style: {
      width: d * 0.5,
      height: 2,
      background: 'white',
      borderRadius: 1
    }
  })), label && /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    checked: checked,
    disabled: disabled,
    onChange: onChange,
    style: {
      position: 'absolute',
      opacity: 0,
      width: 0,
      height: 0
    }
  }, rest)));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/DatePicker.jsx
try { (() => {
/**
 * Vibrant date picker — a calendar month grid with selectable day, prev/next
 * month nav, and mono weekday headers. Single-date selection.
 */
function DatePicker({
  value,
  onChange,
  style
}) {
  const today = new Date();
  const [view, setView] = React.useState(value ? new Date(value) : new Date());
  const y = view.getFullYear(),
    m = view.getMonth();
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const sel = value ? new Date(value) : null;
  const same = (a, b) => a && b && a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const cells = [...Array(first).fill(null), ...Array.from({
    length: days
  }, (_, i) => i + 1)];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 280,
      background: 'var(--vw-white)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-sm)',
      padding: 16,
      fontFamily: 'var(--font-sans)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setView(new Date(y, m - 1, 1)),
    style: navBtn
  }, "\u2039"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 600
    }
  }, months[m], " ", y), /*#__PURE__*/React.createElement("button", {
    onClick: () => setView(new Date(y, m + 1, 1)),
    style: navBtn
  }, "\u203A")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(7,1fr)',
      gap: 2
    }
  }, ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      textAlign: 'center',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-tertiary)',
      padding: '4px 0'
    }
  }, d)), cells.map((d, i) => {
    if (!d) return /*#__PURE__*/React.createElement("span", {
      key: i
    });
    const date = new Date(y, m, d);
    const isSel = same(date, sel),
      isToday = same(date, today);
    return /*#__PURE__*/React.createElement("button", {
      key: i,
      onClick: () => onChange && onChange(date),
      style: {
        aspectRatio: '1',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        background: isSel ? 'var(--vw-blue)' : 'transparent',
        color: isSel ? 'white' : 'var(--text-primary)',
        outline: isToday && !isSel ? '1px solid var(--vw-blue)' : 'none'
      },
      onMouseEnter: e => {
        if (!isSel) e.currentTarget.style.background = 'var(--vw-gray-05)';
      },
      onMouseLeave: e => {
        if (!isSel) e.currentTarget.style.background = 'transparent';
      }
    }, d);
  })));
}
const navBtn = {
  border: '1px solid var(--border-subtle)',
  background: 'var(--vw-white)',
  borderRadius: 'var(--radius-sm)',
  width: 28,
  height: 28,
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  lineHeight: 0
};
Object.assign(__ds_scope, { DatePicker });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/DatePicker.jsx", error: String((e && e.message) || e) }); }

// components/forms/FileUploader.jsx
try { (() => {
/**
 * Vibrant file uploader / drop area. Dashed drop zone with cloud-upload glyph,
 * drag-over highlight, and an uploaded-files list with remove.
 */
function FileUploader({
  files = [],
  onAdd,
  onRemove,
  hint = 'Drag files here or click to browse',
  accept,
  style
}) {
  const [over, setOver] = React.useState(false);
  const inputRef = React.useRef(null);
  const pick = list => {
    if (onAdd && list) onAdd(Array.from(list));
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => inputRef.current && inputRef.current.click(),
    onDragOver: e => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: e => {
      e.preventDefault();
      setOver(false);
      pick(e.dataTransfer.files);
    },
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 8,
      padding: '28px 20px',
      border: `1.5px dashed ${over ? 'var(--vw-blue)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-md)',
      background: over ? 'var(--vw-blue-tint)' : 'var(--vw-gray-02)',
      cursor: 'pointer',
      textAlign: 'center',
      transition: 'all var(--dur-fast)'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "28",
    height: "28",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--vw-blue)",
    strokeWidth: "1.6",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 16V4M7 9l5-5 5 5M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--text-secondary)'
    }
  }, hint), /*#__PURE__*/React.createElement("input", {
    ref: inputRef,
    type: "file",
    multiple: true,
    accept: accept,
    style: {
      display: 'none'
    },
    onChange: e => pick(e.target.files)
  })), files.map((f, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 12px',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--vw-white)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--text-primary)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, f.name || f), f.size != null && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--text-tertiary)'
    }
  }, Math.round(f.size / 1024), " KB"), onRemove && /*#__PURE__*/React.createElement("button", {
    onClick: () => onRemove(i),
    "aria-label": "Remove",
    style: {
      border: 'none',
      background: 'none',
      cursor: 'pointer',
      color: 'var(--text-tertiary)',
      lineHeight: 0
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 16 16",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 4l8 8M12 4l-8 8",
    stroke: "currentColor",
    strokeWidth: "1.6",
    strokeLinecap: "round"
  }))))));
}
Object.assign(__ds_scope, { FileUploader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/FileUploader.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Vibrant text input. Square 4px corners, neutral border, blue focus ring.
 * Supports label, helper/error subtext, prefix/suffix adornments, and
 * status (default / error / success).
 */
function Input({
  label,
  helperText,
  status = 'default',
  size = 'md',
  prefix,
  suffix,
  disabled = false,
  id,
  style,
  ...rest
}) {
  const h = {
    sm: 32,
    md: 40,
    lg: 48
  }[size];
  const statusBorder = {
    default: 'var(--border-default)',
    error: 'var(--vw-error)',
    success: 'var(--vw-success)'
  }[status];
  const helperColor = status === 'error' ? 'var(--vw-error)' : status === 'success' ? 'var(--vw-success)' : 'var(--text-tertiary)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      fontWeight: 500,
      color: 'var(--text-secondary)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: h,
      padding: '0 12px',
      background: disabled ? 'var(--vw-gray-05)' : 'var(--vw-white)',
      border: `1.5px solid ${statusBorder}`,
      borderRadius: 'var(--radius-sm)',
      transition: 'border-color var(--dur-fast)'
    },
    onFocusCapture: e => {
      if (!disabled && status === 'default') e.currentTarget.style.borderColor = 'var(--border-focus)';
    },
    onBlurCapture: e => {
      if (status === 'default') e.currentTarget.style.borderColor = 'var(--border-default)';
    }
  }, prefix && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-tertiary)',
      display: 'inline-flex'
    }
  }, prefix), /*#__PURE__*/React.createElement("input", _extends({
    id: id,
    disabled: disabled,
    style: {
      flex: 1,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontFamily: 'var(--font-sans)',
      fontSize: 15,
      color: 'var(--text-primary)',
      minWidth: 0
    }
  }, rest)), suffix && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-tertiary)',
      display: 'inline-flex'
    }
  }, suffix)), helperText && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 12,
      color: helperColor
    }
  }, helperText));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/MultiSelect.jsx
try { (() => {
/**
 * Vibrant multi-select dropdown. Selected values render as removable chips
 * inside the control; the menu lists options with checkmarks. Square corners.
 */
function MultiSelect({
  label,
  options = [],
  value = [],
  onChange,
  placeholder = 'Select…',
  style
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const h = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const labelOf = o => typeof o === 'object' ? o.label : o;
  const valOf = o => typeof o === 'object' ? o.value : o;
  const toggle = v => onChange && onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      fontWeight: 500,
      color: 'var(--text-secondary)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    onClick: () => setOpen(v => !v),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flexWrap: 'wrap',
      minHeight: 40,
      padding: '5px 10px',
      background: 'var(--vw-white)',
      border: `1.5px solid ${open ? 'var(--border-focus)' : 'var(--border-default)'}`,
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer'
    }
  }, value.length === 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 15,
      color: 'var(--text-tertiary)'
    }
  }, placeholder), value.map(v => {
    const o = options.find(x => valOf(x) === v);
    return /*#__PURE__*/React.createElement("span", {
      key: v,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 24,
        padding: '0 8px',
        borderRadius: 999,
        background: 'var(--vw-blue-tint)',
        color: 'var(--vw-blue)',
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        fontWeight: 500
      }
    }, o ? labelOf(o) : v, /*#__PURE__*/React.createElement("span", {
      onClick: e => {
        e.stopPropagation();
        toggle(v);
      },
      style: {
        cursor: 'pointer',
        lineHeight: 0
      }
    }, /*#__PURE__*/React.createElement("svg", {
      width: "11",
      height: "11",
      viewBox: "0 0 16 16",
      fill: "none"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M4 4l8 8M12 4l-8 8",
      stroke: "currentColor",
      strokeWidth: "1.8",
      strokeLinecap: "round"
    }))));
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      color: 'var(--text-tertiary)',
      lineHeight: 0
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 16 16",
    fill: "none",
    style: {
      transform: open ? 'rotate(180deg)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 6l4 4 4-4",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })))), open && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 'calc(100% + 4px)',
      left: 0,
      right: 0,
      zIndex: 30,
      background: 'var(--vw-white)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-sm)',
      boxShadow: 'var(--shadow-md)',
      padding: 4,
      maxHeight: 220,
      overflowY: 'auto'
    }
  }, options.map(o => {
    const v = valOf(o),
      on = value.includes(v);
    return /*#__PURE__*/React.createElement("div", {
      key: v,
      onClick: () => toggle(v),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        borderRadius: 'var(--radius-xs)',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: 15,
        color: 'var(--text-primary)'
      },
      onMouseEnter: e => e.currentTarget.style.background = 'var(--vw-gray-05)',
      onMouseLeave: e => e.currentTarget.style.background = 'transparent'
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 16,
        height: 16,
        borderRadius: 'var(--radius-xs)',
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: on ? 'var(--vw-blue)' : 'var(--vw-white)',
        border: `1.5px solid ${on ? 'var(--vw-blue)' : 'var(--border-strong)'}`
      }
    }, on && /*#__PURE__*/React.createElement("svg", {
      width: "10",
      height: "10",
      viewBox: "0 0 16 16",
      fill: "none"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M3 8.5l3.2 3.2L13 5",
      stroke: "white",
      strokeWidth: "2.2",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }))), labelOf(o));
  })));
}
Object.assign(__ds_scope, { MultiSelect });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/MultiSelect.jsx", error: String((e && e.message) || e) }); }

// components/forms/NumberInput.jsx
try { (() => {
/** Vibrant number input with stepper −/+ buttons. Mono value, square corners. */
function NumberInput({
  value = 0,
  min = -Infinity,
  max = Infinity,
  step = 1,
  onChange,
  size = 'md',
  disabled = false,
  label,
  style
}) {
  const h = {
    sm: 32,
    md: 40,
    lg: 48
  }[size];
  const set = v => {
    const n = Math.max(min, Math.min(max, v));
    onChange && onChange(n);
  };
  const btn = (sym, fn, dis) => /*#__PURE__*/React.createElement("button", {
    type: "button",
    disabled: dis,
    onClick: fn,
    style: {
      width: h,
      height: '100%',
      border: 'none',
      borderLeft: sym === '+' ? '1px solid var(--border-subtle)' : 'none',
      borderRight: sym === '−' ? '1px solid var(--border-subtle)' : 'none',
      background: 'var(--vw-gray-02)',
      cursor: dis ? 'not-allowed' : 'pointer',
      color: dis ? 'var(--vw-gray-30)' : 'var(--text-primary)',
      fontSize: 18,
      lineHeight: 0,
      fontFamily: 'var(--font-mono)'
    }
  }, sym);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      fontWeight: 500,
      color: 'var(--text-secondary)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      height: h,
      border: '1.5px solid var(--border-default)',
      borderRadius: 'var(--radius-sm)',
      overflow: 'hidden',
      width: 'fit-content',
      opacity: disabled ? 0.5 : 1
    }
  }, btn('−', () => set(value - step), disabled || value <= min), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: value,
    disabled: disabled,
    onChange: e => {
      const n = Number(e.target.value);
      if (!Number.isNaN(n)) set(n);
    },
    style: {
      width: 56,
      border: 'none',
      outline: 'none',
      textAlign: 'center',
      fontFamily: 'var(--font-mono)',
      fontSize: 15,
      color: 'var(--text-primary)'
    }
  }), btn('+', () => set(value + step), disabled || value >= max)));
}
Object.assign(__ds_scope, { NumberInput });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/NumberInput.jsx", error: String((e && e.message) || e) }); }

// components/forms/PhoneInput.jsx
try { (() => {
/**
 * Vibrant phone-number input — a country-code prefix select fused to the
 * number field, sharing one bordered control with a divider.
 */
function PhoneInput({
  label,
  code = '+1',
  codes = ['+1', '+44', '+61', '+91'],
  value = '',
  onChange,
  onCodeChange,
  disabled = false,
  style
}) {
  const [open, setOpen] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      position: 'relative',
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      fontWeight: 500,
      color: 'var(--text-secondary)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      height: 40,
      border: '1.5px solid var(--border-default)',
      borderRadius: 'var(--radius-sm)',
      background: disabled ? 'var(--vw-gray-05)' : 'var(--vw-white)',
      overflow: 'visible'
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => setOpen(v => !v),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 5,
      height: '100%',
      padding: '0 10px',
      border: 'none',
      borderRight: '1px solid var(--border-subtle)',
      background: 'transparent',
      cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
      fontSize: 14,
      color: 'var(--text-primary)'
    }
  }, code, /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 16 16",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 6l4 4 4-4",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))), /*#__PURE__*/React.createElement("input", {
    value: value,
    disabled: disabled,
    onChange: e => onChange && onChange(e.target.value),
    placeholder: "(555) 000-0000",
    style: {
      flex: 1,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      padding: '0 12px',
      fontFamily: 'var(--font-sans)',
      fontSize: 15,
      color: 'var(--text-primary)'
    }
  })), open && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 'calc(100% + 4px)',
      left: 0,
      zIndex: 30,
      minWidth: 90,
      background: 'var(--vw-white)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-sm)',
      boxShadow: 'var(--shadow-md)',
      padding: 4
    }
  }, codes.map(c => /*#__PURE__*/React.createElement("div", {
    key: c,
    onClick: () => {
      onCodeChange && onCodeChange(c);
      setOpen(false);
    },
    style: {
      padding: '7px 10px',
      borderRadius: 'var(--radius-xs)',
      cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
      fontSize: 14,
      color: c === code ? 'var(--vw-blue)' : 'var(--text-primary)'
    },
    onMouseEnter: e => e.currentTarget.style.background = 'var(--vw-gray-05)',
    onMouseLeave: e => e.currentTarget.style.background = 'transparent'
  }, c))));
}
Object.assign(__ds_scope, { PhoneInput });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/PhoneInput.jsx", error: String((e && e.message) || e) }); }

// components/forms/Radio.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Vibrant radio button — circular, blue dot when selected. */
function Radio({
  checked = false,
  label,
  disabled = false,
  onChange,
  name,
  value,
  size = 'md',
  ...rest
}) {
  const d = {
    sm: 16,
    md: 18,
    lg: 20
  }[size];
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      fontFamily: 'var(--font-sans)',
      fontSize: 15,
      color: 'var(--text-primary)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: d,
      height: d,
      borderRadius: '50%',
      flexShrink: 0,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--vw-white)',
      border: `1.5px solid ${checked ? 'var(--vw-blue)' : 'var(--border-strong)'}`,
      transition: 'all var(--dur-fast)'
    }
  }, checked && /*#__PURE__*/React.createElement("span", {
    style: {
      width: d * 0.5,
      height: d * 0.5,
      borderRadius: '50%',
      background: 'var(--vw-blue)'
    }
  })), label && /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("input", _extends({
    type: "radio",
    name: name,
    value: value,
    checked: checked,
    disabled: disabled,
    onChange: onChange,
    style: {
      position: 'absolute',
      opacity: 0,
      width: 0,
      height: 0
    }
  }, rest)));
}
Object.assign(__ds_scope, { Radio });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Radio.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
/**
 * Vibrant select / dropdown. Controlled-lite: manages its own open state and
 * highlights the chosen option. Square 4px corners matching Input.
 */
function Select({
  label,
  options = [],
  value,
  placeholder = 'Select…',
  onChange,
  size = 'md',
  disabled = false,
  style
}) {
  const [open, setOpen] = React.useState(false);
  const h = {
    sm: 32,
    md: 40,
    lg: 48
  }[size];
  const selected = options.find(o => (o.value ?? o) === value);
  const labelOf = o => typeof o === 'object' ? o.label : o;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      fontWeight: 500,
      color: 'var(--text-secondary)'
    }
  }, label), /*#__PURE__*/React.createElement("button", {
    type: "button",
    disabled: disabled,
    onClick: () => setOpen(v => !v),
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      height: h,
      padding: '0 12px',
      width: '100%',
      background: disabled ? 'var(--vw-gray-05)' : 'var(--vw-white)',
      border: `1.5px solid ${open ? 'var(--border-focus)' : 'var(--border-default)'}`,
      borderRadius: 'var(--radius-sm)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'var(--font-sans)',
      fontSize: 15,
      color: selected ? 'var(--text-primary)' : 'var(--text-tertiary)',
      transition: 'border-color var(--dur-fast)'
    }
  }, /*#__PURE__*/React.createElement("span", null, selected ? labelOf(selected) : placeholder), /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 16 16",
    fill: "none",
    style: {
      transform: open ? 'rotate(180deg)' : 'none',
      transition: 'transform var(--dur-fast)'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 6l4 4 4-4",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))), open && !disabled && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 'calc(100% + 4px)',
      left: 0,
      right: 0,
      zIndex: 20,
      background: 'var(--vw-white)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-sm)',
      boxShadow: 'var(--shadow-md)',
      padding: 4,
      maxHeight: 240,
      overflowY: 'auto'
    }
  }, options.map(o => {
    const v = o.value ?? o;
    const isSel = v === value;
    return /*#__PURE__*/React.createElement("div", {
      key: v,
      onClick: () => {
        onChange && onChange(v);
        setOpen(false);
      },
      style: {
        padding: '8px 10px',
        borderRadius: 'var(--radius-xs)',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: 15,
        color: isSel ? 'var(--vw-blue)' : 'var(--text-primary)',
        background: isSel ? 'var(--vw-blue-tint)' : 'transparent'
      },
      onMouseEnter: e => {
        if (!isSel) e.currentTarget.style.background = 'var(--vw-gray-05)';
      },
      onMouseLeave: e => {
        if (!isSel) e.currentTarget.style.background = 'transparent';
      }
    }, labelOf(o));
  })));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Vibrant toggle switch — capsule track, blue when on. */
function Switch({
  checked = false,
  label,
  disabled = false,
  onChange,
  size = 'md',
  ...rest
}) {
  const dims = {
    sm: {
      w: 36,
      h: 20,
      k: 14
    },
    md: {
      w: 44,
      h: 24,
      k: 18
    }
  }[size];
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      fontFamily: 'var(--font-sans)',
      fontSize: 15,
      color: 'var(--text-primary)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: dims.w,
      height: dims.h,
      borderRadius: 999,
      flexShrink: 0,
      padding: 3,
      background: checked ? 'var(--vw-blue)' : 'var(--vw-gray-30)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: checked ? 'flex-end' : 'flex-start',
      transition: 'background var(--dur-base) var(--ease-standard)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: dims.k,
      height: dims.k,
      borderRadius: '50%',
      background: 'white',
      boxShadow: 'var(--shadow-xs)',
      transition: 'all var(--dur-base) var(--ease-standard)'
    }
  })), label && /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    role: "switch",
    checked: checked,
    disabled: disabled,
    onChange: onChange,
    style: {
      position: 'absolute',
      opacity: 0,
      width: 0,
      height: 0
    }
  }, rest)));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Vibrant textarea — matches Input styling, auto-resizable, with label/helper. */
function Textarea({
  label,
  helperText,
  status = 'default',
  rows = 4,
  disabled = false,
  id,
  style,
  ...rest
}) {
  const statusBorder = {
    default: 'var(--border-default)',
    error: 'var(--vw-error)',
    success: 'var(--vw-success)'
  }[status];
  const helperColor = status === 'error' ? 'var(--vw-error)' : status === 'success' ? 'var(--vw-success)' : 'var(--text-tertiary)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      fontWeight: 500,
      color: 'var(--text-secondary)'
    }
  }, label), /*#__PURE__*/React.createElement("textarea", _extends({
    id: id,
    rows: rows,
    disabled: disabled,
    style: {
      resize: 'vertical',
      padding: '10px 12px',
      borderRadius: 'var(--radius-sm)',
      border: `1.5px solid ${statusBorder}`,
      background: disabled ? 'var(--vw-gray-05)' : 'var(--vw-white)',
      fontFamily: 'var(--font-sans)',
      fontSize: 15,
      lineHeight: 1.5,
      color: 'var(--text-primary)',
      outline: 'none'
    },
    onFocus: e => {
      if (status === 'default') e.currentTarget.style.borderColor = 'var(--border-focus)';
    },
    onBlur: e => {
      if (status === 'default') e.currentTarget.style.borderColor = 'var(--border-default)';
    }
  }, rest)), helperText && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 12,
      color: helperColor
    }
  }, helperText));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/icons/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Vibrant Icon. The in-house Figma set mirrors Material naming on a 24px grid,
 * filled/solid, single-color. We render via Material Symbols (Rounded, filled)
 * as the documented closest-match substitution — same grid & fill style — so
 * any Material icon name works (`add`, `delete`, `cloud_upload`, `arrow_forward`,
 * `calendar_month`, `science`, `biotech`, …). Inherits `currentColor`.
 *
 * Requires the Material Symbols stylesheet (loaded once in the host; the cards
 * and UI kits include it). Swap to the licensed in-house glyph SVGs when ready.
 */
function Icon({
  name,
  size = 24,
  weight = 400,
  fill = true,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: "material-symbols-rounded",
    "aria-hidden": "true",
    style: {
      fontSize: size,
      lineHeight: 1,
      userSelect: 'none',
      display: 'inline-flex',
      fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${size}`,
      ...style
    }
  }, rest), name);
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/icons/Icon.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Accordion.jsx
try { (() => {
/**
 * Vibrant accordion / step disclosure. Each item expands to reveal content;
 * supports a mono step-number prefix for the "Step Accordion" pattern.
 */
function Accordion({
  items = [],
  defaultOpen = 0,
  numbered = false,
  style
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      ...style
    }
  }, items.map((it, i) => {
    const isOpen = open === i;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        background: 'var(--vw-white)'
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setOpen(isOpen ? -1 : i),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '14px 16px',
        border: 'none',
        background: isOpen ? 'var(--vw-gray-02)' : 'var(--vw-white)',
        cursor: 'pointer',
        textAlign: 'left'
      }
    }, numbered && /*#__PURE__*/React.createElement("span", {
      style: {
        width: 26,
        height: 26,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isOpen ? 'var(--vw-blue)' : 'var(--vw-gray-10)',
        color: isOpen ? 'white' : 'var(--text-secondary)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12
      }
    }, String(i + 1).padStart(2, '0')), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        fontFamily: 'var(--font-sans)',
        fontSize: 15,
        fontWeight: 600,
        color: 'var(--text-primary)'
      }
    }, it.title), /*#__PURE__*/React.createElement("svg", {
      width: "16",
      height: "16",
      viewBox: "0 0 16 16",
      fill: "none",
      style: {
        transform: isOpen ? 'rotate(180deg)' : 'none',
        transition: 'transform var(--dur-fast)',
        color: 'var(--text-tertiary)'
      }
    }, /*#__PURE__*/React.createElement("path", {
      d: "M4 6l4 4 4-4",
      stroke: "currentColor",
      strokeWidth: "1.5",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }))), isOpen && /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '0 16px 16px',
        paddingLeft: numbered ? 54 : 16,
        fontFamily: 'var(--font-sans)',
        fontSize: 14,
        lineHeight: 1.55,
        color: 'var(--text-secondary)'
      }
    }, it.content));
  }));
}
Object.assign(__ds_scope, { Accordion });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Accordion.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Breadcrumb.jsx
try { (() => {
/** Vibrant breadcrumb trail — mono separators, blue links, ink current page. */
function Breadcrumb({
  items = [],
  style
}) {
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      ...style
    }
  }, items.map((it, i) => {
    const last = i === items.length - 1;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: i
    }, last ? /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-primary)',
        fontWeight: 500
      }
    }, it.label) : /*#__PURE__*/React.createElement("a", {
      href: it.href || '#',
      style: {
        color: 'var(--text-secondary)',
        textDecoration: 'none'
      },
      onMouseEnter: e => e.currentTarget.style.color = 'var(--vw-blue)',
      onMouseLeave: e => e.currentTarget.style.color = 'var(--text-secondary)'
    }, it.label), !last && /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--vw-gray-30)',
        fontFamily: 'var(--font-mono)'
      }
    }, "/"));
  }));
}
Object.assign(__ds_scope, { Breadcrumb });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Breadcrumb.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Menu.jsx
try { (() => {
/**
 * Vibrant menu — dropdown action list anchored to a trigger. Items support
 * leading icon, danger styling, and dividers (`{divider:true}`).
 */
function Menu({
  trigger,
  items = [],
  align = 'left',
  style
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const h = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: 'relative',
      display: 'inline-flex',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => setOpen(v => !v)
  }, trigger), open && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 'calc(100% + 6px)',
      [align]: 0,
      zIndex: 50,
      minWidth: 180,
      background: 'var(--vw-white)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-md)',
      padding: 4
    }
  }, items.map((it, i) => it.divider ? /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      height: 1,
      background: 'var(--border-subtle)',
      margin: '4px 0'
    }
  }) : /*#__PURE__*/React.createElement("button", {
    key: i,
    onClick: () => {
      it.onClick && it.onClick();
      setOpen(false);
    },
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      width: '100%',
      padding: '8px 10px',
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      borderRadius: 'var(--radius-xs)',
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      textAlign: 'left',
      color: it.danger ? 'var(--vw-error)' : 'var(--text-primary)'
    },
    onMouseEnter: e => e.currentTarget.style.background = 'var(--vw-gray-05)',
    onMouseLeave: e => e.currentTarget.style.background = 'transparent'
  }, it.icon, it.label))));
}
Object.assign(__ds_scope, { Menu });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Menu.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Pagination.jsx
try { (() => {
/** Vibrant pagination — square page cells, blue active, prev/next chevrons. */
function Pagination({
  page = 1,
  count = 1,
  onChange,
  style
}) {
  const go = p => {
    if (p >= 1 && p <= count && onChange) onChange(p);
  };
  const pages = [];
  const push = p => pages.push(p);
  if (count <= 7) {
    for (let i = 1; i <= count; i++) push(i);
  } else {
    push(1);
    if (page > 3) push('…');
    for (let i = Math.max(2, page - 1); i <= Math.min(count - 1, page + 1); i++) push(i);
    if (page < count - 2) push('…');
    push(count);
  }
  const cell = (content, opts = {}) => /*#__PURE__*/React.createElement("button", {
    key: opts.key,
    disabled: opts.disabled,
    onClick: opts.onClick,
    style: {
      minWidth: 32,
      height: 32,
      padding: '0 6px',
      border: `1px solid ${opts.active ? 'var(--vw-blue)' : 'var(--border-subtle)'}`,
      borderRadius: 'var(--radius-sm)',
      cursor: opts.disabled ? 'not-allowed' : 'pointer',
      background: opts.active ? 'var(--vw-blue)' : 'var(--vw-white)',
      color: opts.disabled ? 'var(--vw-gray-30)' : opts.active ? 'white' : 'var(--text-primary)',
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      lineHeight: 0
    }
  }, content);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      alignItems: 'center',
      ...style
    }
  }, cell('‹', {
    key: 'prev',
    disabled: page <= 1,
    onClick: () => go(page - 1)
  }), pages.map((p, i) => p === '…' ? /*#__PURE__*/React.createElement("span", {
    key: 'e' + i,
    style: {
      color: 'var(--vw-gray-40)',
      fontFamily: 'var(--font-mono)',
      padding: '0 2px'
    }
  }, "\u2026") : cell(String(p).padStart(2, '0'), {
    key: p,
    active: p === page,
    onClick: () => go(p)
  })), cell('›', {
    key: 'next',
    disabled: page >= count,
    onClick: () => go(page + 1)
  }));
}
Object.assign(__ds_scope, { Pagination });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Pagination.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
/**
 * Vibrant tabs. Underline style (default) or pill/segmented. Active tab gets
 * the blue accent. Mono labels available for a clinical look.
 */
function Tabs({
  tabs = [],
  value,
  onChange,
  variant = 'underline',
  mono = false,
  style
}) {
  const active = value ?? (tabs[0] && (tabs[0].value ?? tabs[0]));
  const labelOf = t => typeof t === 'object' ? t.label : t;
  const valOf = t => typeof t === 'object' ? t.value : t;
  if (variant === 'segmented') {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'inline-flex',
        padding: 3,
        gap: 2,
        background: 'var(--vw-gray-05)',
        borderRadius: 'var(--radius-md)',
        ...style
      }
    }, tabs.map(t => {
      const on = valOf(t) === active;
      return /*#__PURE__*/React.createElement("button", {
        key: valOf(t),
        onClick: () => onChange && onChange(valOf(t)),
        style: {
          border: 'none',
          cursor: 'pointer',
          padding: '6px 14px',
          borderRadius: 'var(--radius-sm)',
          background: on ? 'var(--vw-white)' : 'transparent',
          boxShadow: on ? 'var(--shadow-xs)' : 'none',
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          fontSize: 14,
          fontWeight: on ? 600 : 400,
          color: on ? 'var(--text-primary)' : 'var(--text-tertiary)',
          textTransform: mono ? 'uppercase' : 'none',
          letterSpacing: mono ? '0.04em' : 0,
          transition: 'all var(--dur-fast)'
        }
      }, labelOf(t));
    }));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 24,
      borderBottom: '1px solid var(--border-subtle)',
      ...style
    }
  }, tabs.map(t => {
    const on = valOf(t) === active;
    return /*#__PURE__*/React.createElement("button", {
      key: valOf(t),
      onClick: () => onChange && onChange(valOf(t)),
      style: {
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        padding: '0 0 12px',
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
        fontSize: 15,
        fontWeight: on ? 600 : 400,
        color: on ? 'var(--text-primary)' : 'var(--text-tertiary)',
        borderBottom: `2px solid ${on ? 'var(--vw-blue)' : 'transparent'}`,
        marginBottom: -1,
        textTransform: mono ? 'uppercase' : 'none',
        letterSpacing: mono ? '0.04em' : 0,
        transition: 'color var(--dur-fast)'
      }
    }, labelOf(t));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lab_report/DiversityPanel.jsx
try { (() => {
// Diversity summary block — Shannon index gauge + phyla composition donut.
const {
  Card
} = window.DesignSystem_316cce;
function Donut({
  data,
  size = 150
}) {
  const r = size / 2 - 6,
    c = 2 * Math.PI * r;
  let offset = 0;
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: `0 0 ${size} ${size}`
  }, /*#__PURE__*/React.createElement("g", {
    transform: `rotate(-90 ${size / 2} ${size / 2})`
  }, data.filter(d => d.pct > 0).map(d => {
    const len = d.pct / 100 * c;
    const seg = /*#__PURE__*/React.createElement("circle", {
      key: d.name,
      cx: size / 2,
      cy: size / 2,
      r: r,
      fill: "none",
      stroke: d.color,
      strokeWidth: 26,
      strokeDasharray: `${len} ${c - len}`,
      strokeDashoffset: -offset
    });
    offset += len;
    return seg;
  })));
}
function DiversityPanel({
  diversity,
  phyla
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1.2fr',
      gap: 20,
      marginBottom: 36
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: 20
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      letterSpacing: '.06em',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)',
      marginBottom: 14
    }
  }, "Gut Diversity"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 48,
      fontWeight: 500,
      letterSpacing: '-.02em',
      color: 'var(--text-primary)'
    }
  }, diversity.shannon), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      color: 'var(--text-tertiary)'
    }
  }, "Shannon's Index")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      color: 'var(--text-secondary)',
      marginTop: 6
    }
  }, "Previous ", diversity.prev, " \xB7 Reference \u2265 ", diversity.ref), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      padding: '10px 12px',
      background: 'var(--vw-success-bg)',
      borderRadius: 'var(--radius-sm)',
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      color: 'var(--vw-success)'
    }
  }, diversity.note)), /*#__PURE__*/React.createElement(Card, {
    padding: 20
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      letterSpacing: '.06em',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)',
      marginBottom: 14
    }
  }, "Phyla composition"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 24
    }
  }, /*#__PURE__*/React.createElement(Donut, {
    data: phyla
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '8px 18px',
      flex: 1
    }
  }, phyla.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.name,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 9,
      height: 9,
      borderRadius: '50%',
      background: p.color,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      color: 'var(--text-secondary)'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--text-primary)'
    }
  }, p.pct, "%"), " ", p.name)))))));
}
window.DiversityPanel = DiversityPanel;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lab_report/DiversityPanel.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lab_report/MarkerTable.jsx
try { (() => {
// Marker table rows for the Gut Zoomer report. Renders test name, current/previous
// values, the signature ResultBar, and the reference range.
const {
  ResultBar,
  Badge
} = window.DesignSystem_316cce;
function flagColor(flag) {
  return flag === 'high' || flag === 'low' ? 'var(--vw-result-high-risk)' : flag === 'moderate' ? 'var(--vw-result-moderate)' : 'var(--text-primary)';
}
function MarkerTable({
  title,
  rows,
  range
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      marginBottom: 36
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: 'var(--vw-ink)',
      color: 'white',
      padding: '10px 18px',
      borderRadius: 'var(--radius-sm)'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontSize: 16,
      fontWeight: 600,
      fontFamily: 'var(--font-sans)'
    }
  }, title), range && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 16,
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      letterSpacing: '.04em'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--vw-result-in-control)'
    }
  }, "\u25CF In control"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--vw-result-moderate)'
    }
  }, "\u25CF Moderate"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--vw-result-high-risk)'
    }
  }, "\u25CF High risk"))), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      letterSpacing: '.05em',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)'
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'left',
      padding: '12px 8px',
      fontWeight: 400,
      width: 230
    }
  }, "Test Name"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'left',
      padding: '12px 8px',
      fontWeight: 400,
      width: 70
    }
  }, "Current"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'left',
      padding: '12px 8px',
      fontWeight: 400,
      width: 70
    }
  }, "Previous"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'left',
      padding: '12px 8px',
      fontWeight: 400
    }
  }, "Result"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right',
      padding: '12px 8px',
      fontWeight: 400,
      width: 110
    }
  }, "Reference"))), /*#__PURE__*/React.createElement("tbody", null, rows.map(r => /*#__PURE__*/React.createElement("tr", {
    key: r.name,
    style: {
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '16px 8px',
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 4,
      height: 22,
      borderRadius: 2,
      background: flagColor(r.flag),
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--text-primary)'
    }
  }, r.name)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '16px 8px',
      fontFamily: 'var(--font-mono)',
      fontSize: 18,
      color: flagColor(r.flag)
    }
  }, r.current), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '16px 8px',
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      color: 'var(--text-tertiary)'
    }
  }, r.prev), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '16px 14px 16px 8px'
    }
  }, /*#__PURE__*/React.createElement(ResultBar, {
    min: r.min,
    max: r.max,
    value: r.current,
    zones: r.zones,
    ticks: r.ticks
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '16px 8px',
      textAlign: 'right',
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      color: 'var(--text-secondary)'
    }
  }, r.ref))))));
}
window.MarkerTable = MarkerTable;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lab_report/MarkerTable.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lab_report/data.js
try { (() => {
// Sample Gut Zoomer report data (demo values modeled on the Vibrant sample report).
window.GUT_DATA = {
  patient: {
    name: 'Demo Vibrant America',
    dob: '1996-11-29',
    accession: '3245265476',
    previous: '09/01/2022',
    collected: '11/29/2025'
  },
  diversity: {
    shannon: 2.3,
    prev: 1.3,
    ref: 2.5,
    note: 'High value, high diversity'
  },
  phyla: [{
    name: 'Firmicutes',
    pct: 34.4,
    color: '#4FB0E5'
  }, {
    name: 'Bacteroidetes',
    pct: 53.6,
    color: '#7B6FB0'
  }, {
    name: 'Proteobacteria',
    pct: 9.3,
    color: '#7CC566'
  }, {
    name: 'Actinobacteria',
    pct: 1.7,
    color: '#F1A529'
  }, {
    name: 'Fusobacteria',
    pct: 1.0,
    color: '#E2645A'
  }, {
    name: 'Verrucomicrobia',
    pct: 0,
    color: '#3AA7C1'
  }],
  ratios: [{
    name: 'Firmicutes / Bacteroidetes',
    current: 4.9,
    prev: '0.24',
    min: 0,
    max: 4,
    zones: [{
      to: 0.4,
      color: 'green'
    }, {
      to: 3.5,
      color: 'amber'
    }, {
      to: 4,
      color: 'red'
    }],
    ticks: [0.3, 3.5],
    ref: '< 0.40 Units',
    flag: 'high'
  }],
  commensals: [{
    name: 'Alistipes',
    current: 23.2,
    prev: 18.1,
    min: 0,
    max: 25,
    zones: [{
      to: 0.1,
      color: 'red'
    }, {
      to: 20,
      color: 'green'
    }, {
      to: 25,
      color: 'red'
    }],
    ticks: [0.1, 20],
    ref: '≤20.0',
    flag: 'high'
  }, {
    name: 'Bifidobacterium',
    current: 7.7,
    prev: 9.1,
    min: 0,
    max: 20,
    zones: [{
      to: 9.9,
      color: 'red'
    }, {
      to: 20,
      color: 'green'
    }],
    ticks: [0, 9.9],
    ref: '≥10.0',
    flag: 'high'
  }, {
    name: 'Bifidobacterium adolescentis',
    current: 28.6,
    prev: 12.0,
    min: 0,
    max: 30,
    zones: [{
      to: 9.9,
      color: 'red'
    }, {
      to: 20,
      color: 'green'
    }, {
      to: 30,
      color: 'red'
    }],
    ticks: [9.9, 20],
    ref: '10.0–20.0',
    flag: 'high'
  }, {
    name: 'Bifidobacterium longum',
    current: 9.8,
    prev: 8.2,
    min: 0,
    max: 20,
    zones: [{
      to: 9.9,
      color: 'red'
    }, {
      to: 20,
      color: 'green'
    }],
    ticks: [0, 9.9],
    ref: '≥10.0',
    flag: 'high'
  }, {
    name: 'Blautia',
    current: 20.4,
    prev: 15.6,
    min: 0,
    max: 30,
    zones: [{
      to: 9.9,
      color: 'red'
    }, {
      to: 20,
      color: 'green'
    }, {
      to: 30,
      color: 'red'
    }],
    ticks: [9.9, 20],
    ref: '10.0–20.0',
    flag: 'normal'
  }, {
    name: 'Coprococcus',
    current: 24.3,
    prev: 21.0,
    min: 0,
    max: 30,
    zones: [{
      to: 9.9,
      color: 'red'
    }, {
      to: 20,
      color: 'green'
    }, {
      to: 30,
      color: 'red'
    }],
    ticks: [9.9, 20],
    ref: '10.0–20.0',
    flag: 'high'
  }, {
    name: 'Lactobacillus plantarum',
    current: 8.3,
    prev: 6.4,
    min: 0,
    max: 20,
    zones: [{
      to: 9.9,
      color: 'green'
    }, {
      to: 20,
      color: 'green'
    }],
    ticks: [0, 9.9],
    ref: '≥10.0',
    flag: 'low'
  }, {
    name: 'Lactobacillus rhamnosus',
    current: 9.9,
    prev: 9.2,
    min: 0,
    max: 20,
    zones: [{
      to: 9.9,
      color: 'red'
    }, {
      to: 20,
      color: 'green'
    }],
    ticks: [0, 9.9],
    ref: '≥10.0',
    flag: 'low'
  }],
  permeability: [{
    name: 'Fecal Zonulin (ng/mL)',
    current: 104.2,
    prev: 96.4,
    min: 0,
    max: 300,
    zones: [{
      to: 25,
      color: 'red'
    }, {
      to: 161,
      color: 'green'
    }, {
      to: 300,
      color: 'red'
    }],
    ticks: [25, 160],
    ref: '25.1–160.8',
    flag: 'normal'
  }],
  immunity: [{
    name: 'sIgA (mcg/g)',
    current: 1029.2,
    prev: 980,
    min: 0,
    max: 2000,
    zones: [{
      to: 425,
      color: 'red'
    }, {
      to: 1450,
      color: 'green'
    }, {
      to: 2000,
      color: 'red'
    }],
    ticks: [425, 1450],
    ref: '426.0–1450.0',
    flag: 'normal'
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lab_report/data.js", error: String((e && e.message) || e) }); }

__ds_ns.Logo = __ds_scope.Logo;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.ResultBar = __ds_scope.ResultBar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Modal = __ds_scope.Modal;

__ds_ns.NotificationBar = __ds_scope.NotificationBar;

__ds_ns.ProgressIndicator = __ds_scope.ProgressIndicator;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.ToastStack = __ds_scope.ToastStack;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.DatePicker = __ds_scope.DatePicker;

__ds_ns.FileUploader = __ds_scope.FileUploader;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.MultiSelect = __ds_scope.MultiSelect;

__ds_ns.NumberInput = __ds_scope.NumberInput;

__ds_ns.PhoneInput = __ds_scope.PhoneInput;

__ds_ns.Radio = __ds_scope.Radio;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.Accordion = __ds_scope.Accordion;

__ds_ns.Breadcrumb = __ds_scope.Breadcrumb;

__ds_ns.Menu = __ds_scope.Menu;

__ds_ns.Pagination = __ds_scope.Pagination;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
