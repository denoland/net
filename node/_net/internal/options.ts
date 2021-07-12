const { getOptions } = internalBinding('options');
const { options } = getOptions();

export function getOptionValue(option) {
  return options.get(option)?.value;
}
