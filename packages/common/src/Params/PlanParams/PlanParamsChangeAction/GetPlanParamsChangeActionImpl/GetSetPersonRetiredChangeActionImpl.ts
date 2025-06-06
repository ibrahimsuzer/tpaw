import _ from 'lodash'
import { noCase, assert, block, fGet } from '../../../../Utils'
import { PlanParamsNormalized } from '../../NormalizePlanParams/NormalizePlanParams'
import { normalizePlanParamsInverse } from '../../NormalizePlanParams/NormalizePlanParamsInverse'
import {
  PlanParams,
  CalendarDay,
  Month,
  MonthRange,
  LabeledAmountTimed,
  LabeledAmountTimedLocation,
  GlidePathLocation,
  GlidePath,
  PLAN_PARAMS_CONSTANTS,
  MonthLocation,
} from '../../PlanParams'
import { PlanParamsChangeAction } from '../PlanParamsChangeAction'
import { PlanParamsHelperFns } from '../../PlanParamsHelperFns'
import { PlanParamsChangeActionImpl } from './GetPlanParamsChangeActionImpl'
import { CalendarDayFns } from '../../../../Misc/CalendarDayFns'

export const getSetPersonRetiredChangeActionImpl = ({
  value: personType,
}: Extract<
  PlanParamsChangeAction,
  { type: 'setPersonRetired' }
>): PlanParamsChangeActionImpl => {
  return {
    applyToClone: (clone, planParamsNorm) => {
      _removeRetirementReferences(
        personType,
        clone,
        planParamsNorm.datingInfo.nowAsCalendarDay,
      )
      const person = PlanParamsHelperFns.getPerson(clone, personType)
      person.ages = {
        type: 'retiredWithNoRetirementDateSpecified',
        currentAgeInfo: person.ages.currentAgeInfo,
        maxAge: person.ages.maxAge,
      }
    },
    merge: false,
  }
}

const _removeRetirementReferencesFromLabeledAmountTimedList = (
  personType: 'person1' | 'person2',
  clone: PlanParams,
  nowAsCalendarDay: CalendarDay | null,
) => {
  // Returns a new object only if month is changed.
  const handleMonth = (month: Month): Month | { type: 'inThePast' } => {
    switch (month.type) {
      case 'calendarMonth':
      case 'now':
      case 'numericAge':
        return month
      case 'namedAge':
        if (month.person !== personType) return month
        switch (month.age) {
          case 'lastWorkingMonth':
            return { type: 'inThePast' }
          case 'retirement':
            return {
              type: 'now',
              monthOfEntry: nowAsCalendarDay
                ? {
                    isDatedPlan: true,
                    calendarMonth:
                      CalendarDayFns.toCalendarMonth(nowAsCalendarDay),
                  }
                : { isDatedPlan: false },
            }
          case 'max':
            return month
          default:
            noCase(month)
        }

      default:
        noCase(month)
    }
  }

  // Returns a new object only if monthRange is changed.
  const handleMonthRange = (
    monthRange: MonthRange,
  ): MonthRange | { type: 'inThePast' } => {
    switch (monthRange.type) {
      case 'startAndEnd': {
        const start = handleMonth(monthRange.start)
        const end =
          monthRange.end.type === 'inThePast'
            ? monthRange.end
            : handleMonth(monthRange.end)
        // lastWorkingMonth cannot show up at the start of a month range.
        // This is validated by planParamsGuard.
        assert(start.type !== 'inThePast')
        return start === monthRange.start && end === monthRange.end
          ? monthRange
          : { type: 'startAndEnd', start, end }
      }
      case 'startAndDuration': {
        const start = handleMonth(monthRange.start)
        // lastWorkingMonth cannot show up at the start of a month range.
        // This is validated by planParamsGuard.
        assert(start.type !== 'inThePast')
        return start === monthRange.start
          ? monthRange
          : {
              type: 'startAndDuration',
              start,
              duration: monthRange.duration,
            }
      }
      case 'endAndDuration': {
        const end = handleMonth(monthRange.end)

        return end === monthRange.end
          ? monthRange
          : end.type === 'inThePast'
            ? { type: 'inThePast' }
            : {
                type: 'endAndDuration',
                end,
                duration: monthRange.duration,
              }
      }
      default:
        noCase(monthRange)
    }
  }

  // Returns a new object only if amountAndTiming is changed.
  const handleAmountAndTiming = (
    amountAndTiming: LabeledAmountTimed['amountAndTiming'],
  ): LabeledAmountTimed['amountAndTiming'] => {
    switch (amountAndTiming.type) {
      case 'oneTime':
        const month = handleMonth(amountAndTiming.month)
        return month === amountAndTiming.month
          ? amountAndTiming
          : month.type === 'inThePast'
            ? { type: 'inThePast' }
            : { ...amountAndTiming, month }
      case 'recurring':
        const monthRange = handleMonthRange(amountAndTiming.monthRange)
        return monthRange === amountAndTiming.monthRange
          ? amountAndTiming
          : monthRange.type === 'inThePast'
            ? { type: 'inThePast' }
            : { ...amountAndTiming, monthRange }
      case 'inThePast':
        return amountAndTiming
      default:
        noCase(amountAndTiming)
    }
  }

  const changed = new Map<LabeledAmountTimedLocation, LabeledAmountTimed[]>()
  const addToChanged = (
    location: LabeledAmountTimedLocation,
    value: LabeledAmountTimed,
  ) => {
    const curr = changed.get(location)
    if (curr) {
      curr.push(value)
    } else {
      changed.set(location, [value])
    }
  }

  PlanParamsHelperFns.mapAllLabeledAmountTimedList(
    clone,
    (valueForMonthRange: LabeledAmountTimed, location) => {
      const newAmountAndTiming = handleAmountAndTiming(
        valueForMonthRange.amountAndTiming,
      )
      if (newAmountAndTiming === valueForMonthRange.amountAndTiming) return
      addToChanged(location, valueForMonthRange)
      valueForMonthRange.amountAndTiming = newAmountAndTiming
    },
  )
  return changed
}

const _removeRetirementReferencesFromGlidePaths = (
  personType: 'person1' | 'person2',
  clone: PlanParams,
) => {
  const handleMonth = (month: Month): boolean => {
    switch (month.type) {
      case 'calendarMonth':
      case 'now':
      case 'numericAge':
        return true
      case 'namedAge':
        if (month.person !== personType) return true
        switch (month.age) {
          case 'lastWorkingMonth':
          case 'retirement':
            return false
          case 'max':
            return true
          default:
            noCase(month)
        }
      default:
        noCase(month)
    }
  }

  const glidePathsAdjusted = new Set<GlidePathLocation>()

  PlanParamsHelperFns.forAllGlidePaths(
    clone,
    (glidePath: GlidePath, location) => {
      const intermediateArr = _.values(glidePath.intermediate)
      const newIntermediateArr = intermediateArr.filter((x) =>
        handleMonth(x.month),
      )
      if (intermediateArr.length === newIntermediateArr.length) return
      glidePath.intermediate = _.fromPairs(
        newIntermediateArr.map((x) => [x.id, x]),
      )
      glidePathsAdjusted.add(location)
    },
  )
  assert(PLAN_PARAMS_CONSTANTS.glidePathLocations.length === 1)
  assert(
    PLAN_PARAMS_CONSTANTS.glidePathLocations[0] === 'spawAndSWRStockAllocation',
  )
  return {
    spawAndSWRStockAllocationAdjusted: glidePathsAdjusted.has(
      'spawAndSWRStockAllocation',
    ),
  }
}

const _removeRetirementReferences = (
  personType: 'person1' | 'person2',
  clone: PlanParams,
  nowAsCalendarDay: CalendarDay | null,
) => {
  // To make sure typechecking fails when new locations are added, so
  // we can update this code.
  const __ = (x: MonthLocation) => {
    switch (x) {
      case 'futureSavings':
      case 'incomeDuringRetirement':
      case 'extraSpendingEssential':
      case 'extraSpendingDiscretionary':
      case 'spawAndSWRStockAllocation':
        return
      default:
        noCase(x)
    }
  }

  _removeRetirementReferencesFromLabeledAmountTimedList(
    personType,
    clone,
    nowAsCalendarDay,
  )
  _removeRetirementReferencesFromGlidePaths(personType, clone)
}

export type RetirePersonAdjustments = Exclude<
  ReturnType<typeof getRetirePersonAdjustments>,
  null
>
export const getRetirePersonAdjustments = (
  personType: 'person1' | 'person2',
  planParamsNorm: PlanParamsNormalized,
) => {
  const isFutureSavingsGoingToBeAllowed =
    PlanParamsHelperFns.getIsFutureSavingsAllowed(
      personType === 'person1'
        ? true
        : planParamsNorm.ages.person1.retirement.isRetired,
      personType === 'person2'
        ? true
        : planParamsNorm.ages.person2?.retirement.isRetired,
    )

  // Note: This is not done during the action, but by normalization once
  // action is applied. We still need to let the user know about them.
  const futureSavingsEntriesToBeRemovedDueSectionRemoval = block(() => {
    const entries = planParamsNorm.wealth.futureSavings
    if (entries.length === 0) return []
    if (isFutureSavingsGoingToBeAllowed) return []
    return entries
  })

  const clone = normalizePlanParamsInverse(planParamsNorm)

  const valueForMonthRangeEntriesToBeAdjusted = block(() => {
    const inClone = _removeRetirementReferencesFromLabeledAmountTimedList(
      personType,
      clone,
      planParamsNorm.datingInfo.nowAsCalendarDay,
    )
    // If future savings is not going to be allowed, these will be handled
    // by futureSavingsEntryRemovals.
    if (!isFutureSavingsGoingToBeAllowed) inClone.delete('futureSavings')
    return new Map(
      [...inClone.entries()].map(([location, entries]) => [
        location,
        entries.map((x) =>
          fGet(
            PlanParamsHelperFns.getLabeledAmountTimedListFromLocationAndId(
              planParamsNorm,
              location,
              x.id,
            ),
          ),
        ),
      ]),
    )
  })

  const { spawAndSWRStockAllocationAdjusted } =
    _removeRetirementReferencesFromGlidePaths(personType, clone)

  return futureSavingsEntriesToBeRemovedDueSectionRemoval.length === 0 &&
    valueForMonthRangeEntriesToBeAdjusted.size === 0 &&
    !spawAndSWRStockAllocationAdjusted
    ? null
    : {
        futureSavingsEntriesToBeRemovedDueSectionRemoval,
        valueForMonthRangeEntriesToBeAdjusted,
        spawAndSWRStockAllocationAdjusted,
      }
}
