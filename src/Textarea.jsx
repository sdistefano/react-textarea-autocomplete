// @flow
/* eslint react/no-multi-comp: 0 */

import React from "react";
import PropTypes from "prop-types";
import getCaretCoordinates from "textarea-caret";
import CustomEvent from "custom-event";

import Listeners, { KEY_CODES } from "./listener";
import List from "./List";

import { defaultScrollToItem } from "./utilities";

import type {
  TextareaProps,
  TextareaState,
  caretPositionType,
  outputType,
  triggerType,
  textToReplaceType,
  settingType
} from "./types";

const DEFAULT_CARET_POSITION = "next";

const POSITION_CONFIGURATION = {
  X: {
    LEFT: "rta__autocomplete--left",
    RIGHT: "rta__autocomplete--right"
  },
  Y: {
    TOP: "rta__autocomplete--top",
    BOTTOM: "rta__autocomplete--bottom"
  }
};

const errorMessage = (message: string) =>
  console.error(
    `RTA: dataProvider fails: ${message}
    \nCheck the documentation or create issue if you think it's bug. https://github.com/webscopeio/react-textarea-autocomplete/issues`
  );

// The main purpose of this component is to figure out to witch side should be autocomplete opened
type AutocompleteProps = {
  style: ?Object,
  className: ?string,
  innerRef: () => void,
  boundariesElement: string | HTMLElement,
  top: ?number,
  left: ?number,
  children: *
};

type AutocompleteState = {
  xConfig: string,
  yConfig: string,
  dropdownHeight: number,
  dropdownWidth: number
};

class Autocomplete extends React.Component<
  AutocompleteProps,
  AutocompleteState
> {
  state = {
    xConfig: POSITION_CONFIGURATION.X.RIGHT,
    yConfig: POSITION_CONFIGURATION.Y.BOTTOM,
    dropdownHeight: 0,
    dropdownWidth: 0
  };

  containerElem: HTMLElement;

  ref: HTMLElement;

  componentDidMount() {
    const { boundariesElement } = this.props;

    if (typeof boundariesElement === "string") {
      const elem = document.querySelector(boundariesElement);
      if (!elem) {
        throw new Error(
          "RTA: Invalid prop boundariesElement: it has to be string or HTMLElement."
        );
      }
      this.containerElem = elem;
    } else if (boundariesElement instanceof HTMLElement) {
      this.containerElem = boundariesElement;
    } else {
      throw new Error(
        "RTA: Invalid prop boundariesElement: it has to be string or HTMLElement."
      );
    }

    if (!this.containerElem || !this.containerElem.contains(this.ref)) {
      if (process.env.NODE_ENV !== "test") {
        throw new Error(
          "RTA: Invalid prop boundariesElement: it has to be one of the parents of the RTA."
        );
      }
    }
  }

  _calculatePosition = () => {
    if (!this.containerElem || !this.ref) {
      return;
    }

    // this is dumb fallback mostly because tests
    const fallback = {
      x: 0,
      y: 0,
      height: 0,
      width: 0
    };

    const containerRects = this.containerElem.getClientRects()[0] || fallback;
    const dropdownRects = this.ref.getClientRects()[0] || fallback;

    // IE 11 doesn't know about x, y property...
    // $FlowFixMe
    const containerX: number = containerRects.x || containerRects.left;
    // $FlowFixMe
    const containerY: number = containerRects.y || containerRects.top;
    // $FlowFixMe
    const dropdownX: number = dropdownRects.x || dropdownRects.left;
    // $FlowFixMe
    const dropdownY: number = dropdownRects.y || dropdownRects.top;

    const dropdownWidth = dropdownRects.width;
    const dropdownHeight = dropdownRects.height;

    const xConfig =
      containerX + containerRects.width > dropdownX + dropdownWidth
        ? POSITION_CONFIGURATION.X.RIGHT
        : POSITION_CONFIGURATION.X.LEFT;

    const yConfig =
      containerY + containerRects.height > dropdownY + dropdownHeight
        ? POSITION_CONFIGURATION.Y.BOTTOM
        : POSITION_CONFIGURATION.Y.TOP;

    if (
      this.state.dropdownHeight === dropdownHeight &&
      this.state.dropdownWidth === dropdownWidth
    )
      return;

    this.setState({
      xConfig,
      yConfig,
      dropdownHeight,
      dropdownWidth
    });
  };

  componentDidUpdate() {
    this._calculatePosition();
  }

  render() {
    const { style, className, innerRef, children, top, left } = this.props;
    const { xConfig, yConfig, dropdownHeight, dropdownWidth } = this.state;

    const positionStyle = {
      // eslint-disable-next-line
      top: top
        ? yConfig === POSITION_CONFIGURATION.Y.BOTTOM
          ? top
          : top - dropdownHeight
        : 0,
      // eslint-disable-next-line
      left: left
        ? xConfig === POSITION_CONFIGURATION.X.RIGHT
          ? left
          : left - dropdownWidth
        : 0
    };

    return (
      <div
        ref={ref => {
          // $FlowFixMe
          this.ref = ref;
          // $FlowFixMe
          innerRef(ref);
        }}
        className={`rta__autocomplete ${xConfig} ${yConfig} ${className || ""}`}
        style={{ ...style, ...positionStyle }}
      >
        {children}
      </div>
    );
  }
}

class ReactTextareaAutocomplete extends React.Component<
  TextareaProps,
  TextareaState
> {
  static defaultProps = {
    movePopupAsYouType: false,
    value: null,
    minChar: 1,
    boundariesElement: "body",
    scrollToItem: true,
    textAreaComponent: "textarea"
  };

  constructor(props: TextareaProps) {
    super(props);

    const { loadingComponent, trigger, value } = this.props;

    if (value) this.state.value = value;

    this._createRegExp();

    if (!loadingComponent) {
      throw new Error("RTA: loadingComponent is not defined");
    }

    if (!trigger) {
      throw new Error("RTA: trigger is not defined");
    }
  }

  state = {
    top: null,
    left: null,
    currentTrigger: null,
    actualToken: "",
    data: null,
    value: "",
    dataLoading: false,
    selectionEnd: 0,
    component: null,
    textToReplace: null
  };

  escListenerInit = () => {
    if (!this.escListener) {
      this.escListener = Listeners.add(KEY_CODES.ESC, this._closeAutocomplete);
    }
  };

  escListenerDestroy = () => {
    if (this.escListener) {
      Listeners.remove(this.escListener);
      this.escListener = null;
    }
  };

  componentDidMount() {
    Listeners.startListen(this.textareaRef);
  }

  componentDidUpdate({ trigger: oldTrigger, value: oldValue }: TextareaProps) {
    const { trigger, value } = this.props;
    if (Object.keys(trigger).join("") !== Object.keys(oldTrigger).join("")) {
      this._createRegExp();
    }

    if (oldValue !== value && this.lastValueBubbledEvent !== value) {
      this.lastTrigger = 0;
      this._changeHandler();
    }
  }

  static getDerivedStateFromProps({ value }: TextareaProps) {
    if (value === null || value === undefined) return null;

    return {
      value
    };
  }

  componentWillUnmount() {
    this.escListenerDestroy();
    Listeners.stopListen(this.textareaRef);
  }

  getSelectionPosition = (): ?{|
    selectionStart: number,
    selectionEnd: number
  |} => {
    if (!this.textareaRef) return null;

    return {
      selectionStart: this.textareaRef.selectionStart,
      selectionEnd: this.textareaRef.selectionEnd
    };
  };

  getSelectedText = (): ?string => {
    if (!this.textareaRef) return null;
    const { selectionStart, selectionEnd } = this.textareaRef;

    if (selectionStart === selectionEnd) return null;

    return this.state.value.substr(
      selectionStart,
      selectionEnd - selectionStart
    );
  };

  setCaretPosition = (position: number = 0) => {
    if (!this.textareaRef) return;

    this.textareaRef.focus();
    this.textareaRef.setSelectionRange(position, position);
  };

  getCaretPosition = (): number => {
    if (!this.textareaRef) {
      return 0;
    }

    const position = this.textareaRef.selectionEnd;
    return position;
  };

  _onSelect = (newToken: textToReplaceType) => {
    const { selectionEnd, currentTrigger, value: textareaValue } = this.state;
    const { trigger } = this.props;

    if (!currentTrigger) return;

    const computeCaretPosition = (
      position: caretPositionType,
      token: string,
      startToken: number
    ): number => {
      switch (position) {
        case "start":
          return startToken;
        case "next":
        case "end":
          return startToken + token.length;
        default:
          if (!Number.isInteger(position)) {
            throw new Error(
              'RTA: caretPosition should be "start", "next", "end" or number.'
            );
          }

          return position;
      }
    };

    const textToModify = textareaValue.slice(0, selectionEnd);

    const startOfTokenPosition = textToModify.search(
      /**
       * It's important to escape the currentTrigger char for chars like [, (,...
       */
      new RegExp(
        `\\${currentTrigger}${`[^\\${currentTrigger}${
          trigger[currentTrigger].allowWhitespace ? "" : "\\s"
        }]`}*$`
      )
    );

    // we add space after emoji is selected if a caret position is next
    const newTokenString =
      newToken.caretPosition === "next" ? `${newToken.text} ` : newToken.text;

    const newCaretPosition = computeCaretPosition(
      newToken.caretPosition,
      newTokenString,
      startOfTokenPosition
    );

    const modifiedText =
      textToModify.substring(0, startOfTokenPosition) + newTokenString;

    const newValue = textareaValue.replace(textToModify, modifiedText);
    // set the new textarea value and after that set the caret back to its position
    this.setState(
      {
        value: newValue,
        dataLoading: false
      },
      () => {
        const insertedTrigger = this.tokenRegExpEnding.exec(newTokenString);
        const insertedTriggerModifier = insertedTrigger
          ? insertedTrigger[0].length
          : 1;
        this.lastTrigger = newCaretPosition - insertedTriggerModifier;
        this.textareaRef.value = newValue;
        this._changeHandler();

        const scrollTop = this.textareaRef.scrollTop;
        this.setCaretPosition(newCaretPosition);
        /*
          Chrome does not maintain scroll position
          Relevant discussion https://github.com/webscopeio/react-textarea-autocomplete/pull/97
        */
        if (window.chrome) {
          this.textareaRef.scrollTop = scrollTop;
        }
      }
    );
  };

  _getTextToReplace = ({
    actualToken,
    currentTrigger
  }: {|
    actualToken: string,
    currentTrigger: string
  |}): ?outputType => {
    const triggerSettings = this.props.trigger[currentTrigger];

    if (!currentTrigger || !triggerSettings) return null;

    const { output } = triggerSettings;

    return (item: Object | string) => {
      if (
        typeof item === "object" &&
        (!output || typeof output !== "function")
      ) {
        throw new Error(
          'Output functor is not defined! If you are using items as object you have to define "output" function. https://github.com/webscopeio/react-textarea-autocomplete#trigger-type'
        );
      }

      if (output) {
        const textToReplace = output(item, currentTrigger);

        if (!textToReplace || typeof textToReplace === "number") {
          throw new Error(
            `Output functor should return string or object in shape {text: string, caretPosition: string | number}.\nGot "${String(
              textToReplace
            )}". Check the implementation for trigger "${currentTrigger}" and its token "${actualToken}"\n\nSee https://github.com/webscopeio/react-textarea-autocomplete#trigger-type for more informations.\n`
          );
        }

        if (typeof textToReplace === "string") {
          return {
            text: textToReplace,
            caretPosition: DEFAULT_CARET_POSITION
          };
        }

        if (!textToReplace.text) {
          throw new Error(
            `Output "text" is not defined! Object should has shape {text: string, caretPosition: string | number}. Check the implementation for trigger "${currentTrigger}" and its token "${actualToken}"\n`
          );
        }

        if (!textToReplace.caretPosition) {
          throw new Error(
            `Output "caretPosition" is not defined! Object should has shape {text: string, caretPosition: string | number}. Check the implementation for trigger "${currentTrigger}" and its token "${actualToken}"\n`
          );
        }

        return textToReplace;
      }

      if (typeof item !== "string") {
        throw new Error("Output item should be string\n");
      }

      return {
        text: `${currentTrigger}${item}${currentTrigger}`,
        caretPosition: DEFAULT_CARET_POSITION
      };
    };
  };

  _getCurrentTriggerSettings = (): ?settingType => {
    const { currentTrigger } = this.state;

    if (!currentTrigger) return null;

    return this.props.trigger[currentTrigger];
  };

  _getValuesFromProvider = () => {
    const { currentTrigger, actualToken } = this.state;
    const triggerSettings = this._getCurrentTriggerSettings();

    if (!currentTrigger || !triggerSettings) {
      return;
    }

    const { dataProvider, component } = triggerSettings;

    if (typeof dataProvider !== "function") {
      throw new Error("Trigger provider has to be a function!");
    }

    this.setState({
      dataLoading: true
    });

    let providedData = dataProvider(actualToken);

    if (!(providedData instanceof Promise)) {
      providedData = Promise.resolve(providedData);
    }

    providedData
      .then(data => {
        if (!Array.isArray(data)) {
          throw new Error("Trigger provider has to provide an array!");
        }

        if (typeof component !== "function") {
          throw new Error("Component should be defined!");
        }

        // throw away if we resolved old trigger
        if (currentTrigger !== this.state.currentTrigger) return;

        // if we haven't resolved any data let's close the autocomplete
        if (!data.length) {
          this._closeAutocomplete();
          return;
        }

        this.setState({
          dataLoading: false,
          data,
          component
        });
      })
      .catch(e => errorMessage(e.message));
  };

  _getSuggestions = (): ?Array<Object | string> => {
    const { currentTrigger, data } = this.state;

    if (!currentTrigger || !data || (data && !data.length)) return null;

    return data;
  };

  _createRegExp = () => {
    const { trigger } = this.props;

    // negative lookahead to match only the trigger + the actual token = "bladhwd:adawd:word test" => ":word"
    // https://stackoverflow.com/a/8057827/2719917
    this.tokenRegExp = new RegExp(
      `(${Object.keys(trigger)
        // the sort is important for multi-char combos as "/kick", "/"
        .sort((a, b) => {
          if (a < b) {
            return 1;
          }
          if (a > b) {
            return -1;
          }
          return 0;
        })
        .map(a => `\\${a}`)
        .join("|")})((?:(?!\\1)[^\\s])*$)`
    );

    this.tokenRegExpEnding = new RegExp(
      `(${Object.keys(trigger)
        // the sort is important for multi-char combos as "/kick", "/"
        .sort((a, b) => {
          if (a < b) {
            return 1;
          }
          if (a > b) {
            return -1;
          }
          return 0;
        })
        .map(a => `\\${a}`)
        .join("|")})$`
    );
  };

  /**
   * Close autocomplete, also clean up trigger (to avoid slow promises)
   */
  _closeAutocomplete = () => {
    this.escListenerDestroy();
    this.setState({
      data: null,
      dataLoading: false,
      currentTrigger: null,
      top: null,
      left: null
    });
  };

  _cleanUpProps = (): Object => {
    const props = { ...this.props };
    const notSafe = [
      "loadingComponent",
      "boundariesElement",
      "containerStyle",
      "minChar",
      "scrollToItem",
      "ref",
      "innerRef",
      "onChange",
      "onCaretPositionChange",
      "className",
      "value",
      "trigger",
      "listStyle",
      "itemStyle",
      "containerStyle",
      "loaderStyle",
      "className",
      "containerClassName",
      "listClassName",
      "itemClassName",
      "loaderClassName",
      "dropdownStyle",
      "dropdownClassName",
      "movePopupAsYouType",
      "textAreaComponent"
    ];

    // eslint-disable-next-line
    for (const prop in props) {
      if (notSafe.includes(prop)) delete props[prop];
    }

    return props;
  };

  _changeHandler = (e?: SyntheticInputEvent<*>) => {
    const {
      trigger,
      onChange,
      minChar,
      onCaretPositionChange,
      movePopupAsYouType
    } = this.props;
    const { top, left } = this.state;

    let event = e;
    if (!event) {
      // fire onChange event after successful selection
      event = new CustomEvent("change", { bubbles: true });
      this.textareaRef.dispatchEvent(event);
    }

    const textarea = event.target;
    const { selectionEnd } = textarea;
    const value = textarea.value;
    this.lastValueBubbledEvent = value;

    if (onChange && event) {
      event.persist && event.persist();
      onChange(event);
    }

    if (onCaretPositionChange) {
      const caretPosition = this.getCaretPosition();
      onCaretPositionChange(caretPosition);
    }

    this.setState({
      value
    });

    const cleanLastTrigger = () => {
      this.lastTrigger = selectionEnd - 1;
    };

    if (selectionEnd <= this.lastTrigger) {
      cleanLastTrigger();
    }

    const affectedTextareaValue = value.slice(this.lastTrigger, selectionEnd);

    let tokenMatch = this.tokenRegExp.exec(affectedTextareaValue);
    let lastToken = tokenMatch && tokenMatch[0];

    let currentTrigger = (tokenMatch && tokenMatch[1]) || null;

    // with this approach we want to know if the user just inserted a new trigger sequence
    const isNewTrigger = this.tokenRegExpEnding.exec(affectedTextareaValue);

    if (isNewTrigger) {
      cleanLastTrigger();
    }

    /*
     if we lost the trigger token or there is no following character we want to close
     the autocomplete
    */
    if (
      (!lastToken || lastToken.length <= minChar) &&
      // check if our current trigger disallows whitespace
      ((this.state.currentTrigger &&
        !trigger[this.state.currentTrigger].allowWhitespace) ||
        !this.state.currentTrigger)
    ) {
      this._closeAutocomplete();
      return;
    }

    /**
     * This code has to be sync that is the reason why we obtain the currentTrigger
     * from currentTrigger not this.state.currentTrigger
     *
     * Check if the currently typed token has to be afterWhitespace, or not.
     */
    if (
      currentTrigger &&
      trigger[currentTrigger].afterWhitespace &&
      value[selectionEnd - 2] !== " "
    ) {
      this._closeAutocomplete();
      return;
    }

    /**
      If our current trigger allows whitespace
      get the correct token for DataProvider, so we need to construct new RegExp
     */
    if (
      this.state.currentTrigger &&
      trigger[this.state.currentTrigger].allowWhitespace
    ) {
      tokenMatch = new RegExp(`\\${this.state.currentTrigger}.*$`).exec(
        value.slice(0, selectionEnd)
      );
      lastToken = tokenMatch && tokenMatch[0];

      if (!lastToken) {
        this._closeAutocomplete();
        return;
      }

      currentTrigger =
        Object.keys(trigger).find(a => a === lastToken[0]) || null;
    }

    const actualToken = lastToken.slice(1);

    // if trigger is not configured step out from the function, otherwise proceed
    if (!currentTrigger) {
      return;
    }

    if (
      movePopupAsYouType ||
      (top === null && left === null) ||
      // if the trigger got changed, let's reposition the autocomplete
      this.state.currentTrigger !== currentTrigger
    ) {
      const { top: newTop, left: newLeft } = getCaretCoordinates(
        textarea,
        selectionEnd
      );

      this.setState({
        // make position relative to textarea
        top: newTop - this.textareaRef.scrollTop || 0,
        left: newLeft
      });
    }

    this.escListenerInit();

    this.setState(
      {
        selectionEnd,
        currentTrigger,
        textToReplace: this._getTextToReplace({
          actualToken,
          currentTrigger
        }),
        actualToken
      },
      () => {
        try {
          this._getValuesFromProvider();
        } catch (err) {
          errorMessage(err.message);
        }
      }
    );
  };

  _selectHandler = (e: SyntheticInputEvent<*>) => {
    const { onCaretPositionChange, onSelect } = this.props;

    if (onCaretPositionChange) {
      const caretPosition = this.getCaretPosition();
      onCaretPositionChange(caretPosition);
    }

    if (onSelect) {
      e.persist();
      onSelect(e);
    }
  };

  _onClickAndBlurHandler = (e: SyntheticFocusEvent<*>) => {
    const { onBlur } = this.props;

    // If this is a click: e.target is the textarea, and e.relatedTarget is the thing
    // that was actually clicked. If we clicked inside the autoselect dropdown, then
    // that's not a blur, from the autoselect's point of view, so then do nothing.
    const el = e.relatedTarget;
    if (
      this.dropdownRef &&
      el instanceof Node &&
      this.dropdownRef.contains(el)
    ) {
      return;
    }

    this._closeAutocomplete();

    if (onBlur) {
      e.persist();
      onBlur(e);
    }
  };

  _onScrollHandler = () => {
    this._closeAutocomplete();
  };

  _dropdownScroll = (item: HTMLDivElement) => {
    const { scrollToItem } = this.props;

    if (!scrollToItem) return;

    if (scrollToItem === true) {
      defaultScrollToItem(this.dropdownRef, item);
      return;
    }

    if (typeof scrollToItem !== "function" || scrollToItem.length !== 2) {
      throw new Error(
        "`scrollToItem` has to be boolean (true for default implementation) or function with two parameters: container, item."
      );
    }

    scrollToItem(this.dropdownRef, item);
  };

  _isAutocompleteOpen = () => {
    const { dataLoading, currentTrigger } = this.state;
    const suggestionData = this._getSuggestions();

    return (dataLoading || suggestionData) && currentTrigger;
  };

  props: TextareaProps;

  textareaRef: HTMLInputElement;

  dropdownRef: HTMLDivElement;

  tokenRegExp: RegExp;

  lastValueBubbledEvent: string;

  tokenRegExpEnding: RegExp;

  // Last trigger index, to know when user selected the item and we should stop showing the autocomplete
  lastTrigger: number = 0;

  escListener: ?number = null;

  render() {
    const {
      loadingComponent: Loader,
      style,
      className,
      listStyle,
      itemStyle,
      boundariesElement,
      movePopupAsYouType,
      listClassName,
      itemClassName,
      dropdownClassName,
      dropdownStyle,
      containerStyle,
      containerClassName,
      loaderStyle,
      loaderClassName,
      textAreaComponent
    } = this.props;
    const {
      left,
      top,
      dataLoading,
      component,
      value,
      textToReplace
    } = this.state;

    const isAutocompleteOpen = this._isAutocompleteOpen();
    const suggestionData = this._getSuggestions();
    const extraAttrs = {};
    let TextAreaComponent;
    if (textAreaComponent.component) {
      TextAreaComponent = textAreaComponent.component;
      extraAttrs[textAreaComponent.ref] = x => {
        this.textareaRef = x;
      };
    } else {
      TextAreaComponent = textAreaComponent;
    }

    return (
      <div
        className={`rta ${
          dataLoading === true ? "rta--loading" : ""
        } ${containerClassName || ""}`}
        style={containerStyle}
      >
        <TextAreaComponent
          {...this._cleanUpProps()}
          ref={ref => {
            this.props.innerRef && this.props.innerRef(ref);
            this.textareaRef = ref;
          }}
          className={`rta__textarea ${className || ""}`}
          onChange={this._changeHandler}
          onSelect={this._selectHandler}
          onScroll={this._onScrollHandler}
          onClick={
            // The textarea itself is outside the autoselect dropdown.
            this._onClickAndBlurHandler
          }
          onBlur={this._onClickAndBlurHandler}
          value={value}
          style={style}
          {...extraAttrs}
        />
        {isAutocompleteOpen && (
          <Autocomplete
            innerRef={ref => {
              // $FlowFixMe
              this.dropdownRef = ref;
            }}
            top={top}
            left={left}
            style={dropdownStyle}
            className={dropdownClassName}
            movePopupAsYouType={movePopupAsYouType}
            boundariesElement={boundariesElement}
          >
            {suggestionData && component && textToReplace && (
              <List
                values={suggestionData}
                component={component}
                style={listStyle}
                className={listClassName}
                itemClassName={itemClassName}
                itemStyle={itemStyle}
                getTextToReplace={textToReplace}
                onSelect={this._onSelect}
                dropdownScroll={this._dropdownScroll}
              />
            )}
            {dataLoading && (
              <div
                className={`rta__loader ${
                  suggestionData !== null
                    ? "rta__loader--suggestion-data"
                    : "rta__loader--empty-suggestion-data"
                } ${loaderClassName || ""}`}
                style={loaderStyle}
              >
                <Loader data={suggestionData} />
              </div>
            )}
          </Autocomplete>
        )}
      </div>
    );
  }
}

const containerPropCheck = ({ boundariesElement }) => {
  if (!boundariesElement) return null;

  if (
    typeof boundariesElement !== "string" &&
    !(boundariesElement instanceof HTMLElement)
  ) {
    return Error(
      "Invalid prop boundariesElement: it has to be string or HTMLElement."
    );
  }

  return null;
};

const triggerPropsCheck = ({ trigger }: { trigger: triggerType }) => {
  if (!trigger) return Error("Invalid prop trigger. Prop missing.");

  const triggers = Object.entries(trigger);

  for (let i = 0; i < triggers.length; i += 1) {
    const [triggerChar, settings] = triggers[i];

    if (typeof triggerChar !== "string") {
      return Error(
        "Invalid prop trigger. Keys of the object has to be string."
      );
    }

    // $FlowFixMe
    const triggerSetting: triggerType = settings;

    const {
      component,
      dataProvider,
      output,
      afterWhitespace,
      allowWhitespace
    } = triggerSetting;

    if (!component || typeof component !== "function") {
      return Error("Invalid prop trigger: component should be defined.");
    }

    if (!dataProvider || typeof dataProvider !== "function") {
      return Error("Invalid prop trigger: dataProvider should be defined.");
    }

    if (output && typeof output !== "function") {
      return Error("Invalid prop trigger: output should be a function.");
    }

    if (afterWhitespace && allowWhitespace) {
      return Error(
        "Invalid prop trigger: afterWhitespace and allowWhitespace can be used together"
      );
    }
  }

  return null;
};

ReactTextareaAutocomplete.propTypes = {
  value: PropTypes.string,
  loadingComponent: PropTypes.func.isRequired,
  minChar: PropTypes.number,
  onChange: PropTypes.func,
  onSelect: PropTypes.func,
  onBlur: PropTypes.func,
  textAreaComponent: PropTypes.oneOf([PropTypes.string, PropTypes.Object]),
  movePopupAsYouType: PropTypes.bool,
  onCaretPositionChange: PropTypes.func,
  className: PropTypes.string,
  containerStyle: PropTypes.object,
  containerClassName: PropTypes.string,
  style: PropTypes.object,
  listStyle: PropTypes.object,
  itemStyle: PropTypes.object,
  loaderStyle: PropTypes.object,
  dropdownStyle: PropTypes.object,
  listClassName: PropTypes.string,
  itemClassName: PropTypes.string,
  loaderClassName: PropTypes.string,
  dropdownClassName: PropTypes.string,
  boundariesElement: containerPropCheck, //eslint-disable-line
  trigger: triggerPropsCheck //eslint-disable-line
};

export default ReactTextareaAutocomplete;
