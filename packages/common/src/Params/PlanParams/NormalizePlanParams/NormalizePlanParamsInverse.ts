import jsonpatch from 'fast-json-patch'
import _, { isDate } from 'lodash'
import { normalizeGlidePath } from './NormalizeGlidePath'
import { NormalizedMonthRange } from './NormalizeLabeledAmountTimedList/NormalizeAmountAndTimingRecurring'
import { NormalizedLabeledAmountTimed } from './NormalizeLabeledAmountTimedList/NormalizeLabeledAmountTimedList'
import {
  PlanParamsNormalized,
  normalizePlanParamsUnchecked,
} from './NormalizePlanParams'
import { assert, block, fGet, noCase } from '../../../Utils'
import { currentPlanParamsVersion, LabeledAmountTimed, LabeledAmountTimedList, MonthRange, Person, PlanParams } from '../PlanParams'

export const normalizePlanParamsInverse = (
  originalNorm: PlanParamsNormalized,
) => {
  const deNorm = _normalizePlanParamsInverseUnchecked(originalNorm)
  const reNorm = normalizePlanParamsUnchecked(
    deNorm,
    originalNorm.datingInfo.isDated
      ? {
          timestamp: originalNorm.datingInfo.nowAsTimestamp,
          calendarDay: originalNorm.datingInfo.nowAsCalendarDay,
        }
      : {
          timestamp: originalNorm.datingInfo.nowAsTimestampNominal,
          calendarDay: null,
        },
  )

  // If retirement.agsAsMFNIfSpecifiedElseNull is in the past in originalNorm,
  // it will be null in reNorm.
  reNorm.ages.person1.retirement.ageAsMFNIfSpecifiedElseNull =
    originalNorm.ages.person1.retirement.ageAsMFNIfSpecifiedElseNull
  if (reNorm.ages.person2) {
    reNorm.ages.person2.retirement.ageAsMFNIfSpecifiedElseNull = fGet(
      originalNorm.ages.person2,
    ).retirement.ageAsMFNIfSpecifiedElseNull
  }
  const diff = jsonpatch.compare(originalNorm, reNorm)
  const reverseDiff = jsonpatch.compare(reNorm, originalNorm)
  const checkFailed = diff.length > 0 || reverseDiff.length > 0
  assert(!checkFailed)
  return deNorm
}

const _normalizePlanParamsInverseUnchecked = (
  norm: PlanParamsNormalized,
): PlanParams => {
  const _forMonthRange = (norm: NormalizedMonthRange): MonthRange => {
    switch (norm.type) {
      case 'startAndEnd':
        return {
          type: 'startAndEnd',
          start: norm.start.baseValue,
          end: norm.end.isInThePast
            ? { type: 'inThePast' }
            : norm.end.baseValue,
        }
      case 'startAndDuration':
        return {
          type: 'startAndDuration',
          start: norm.start.baseValue,
          duration: norm.duration.baseValue,
        }
      case 'endAndDuration':
        return {
          type: 'endAndDuration',
          end: norm.end.baseValue,
          duration: norm.duration.baseValue,
        }
      default:
        noCase(norm)
    }
  }

  const _forLabeledAmountTimed = (
    x: NormalizedLabeledAmountTimed,
  ): LabeledAmountTimed => ({
    label: x.label,
    nominal: x.nominal,
    id: x.id,
    sortIndex: x.sortIndex,
    colorIndex: x.colorIndex,
    amountAndTiming: block(() => {
      const norm = x.amountAndTiming
      switch (norm.type) {
        case 'inThePast':
          return { type: 'inThePast' }
        case 'oneTime':
          return {
            type: 'oneTime',
            amount: norm.amount,
            month: norm.month.baseValue,
          }
        case 'recurring':
          return {
            type: 'recurring',
            monthRange: _forMonthRange(norm.monthRange),
            everyXMonths: norm.everyXMonths,
            baseAmount: norm.baseAmount,
            delta: norm.delta,
          }
        default:
          noCase(norm)
      }
    }),
  })

  const _forLabeledAmountTimedList = (
    x: NormalizedLabeledAmountTimed[],
  ): LabeledAmountTimedList =>
    _.fromPairs(x.map((x) => [x.id, _forLabeledAmountTimed(x)]))

  return {
    v: currentPlanParamsVersion,
    timestamp: norm.timestamp,
    datingInfo: norm.datingInfo.isDated
      ? { isDated: true }
      : {
          isDated: false,
          marketDataAsOfEndOfDayInNY:
            norm.datingInfo.marketDataAsOfEndOfDayInNY,
        },
    dialogPositionNominal: norm.dialogPosition.effective,
    people: block(() => {
      const _getPerson = (n: typeof norm.ages.person1): Person => {
        const currentAgeInfo: Person['ages']['currentAgeInfo'] = n
          .currentAgeInfo.isDatedPlan
          ? { isDatedPlan: true, monthOfBirth: n.currentAgeInfo.baseValue }
          : { isDatedPlan: false, currentAge: n.currentAgeInfo.baseValue }
        return {
          ages:
            n.retirement.ageIfInFuture === null
              ? {
                  type: 'retiredWithNoRetirementDateSpecified',
                  currentAgeInfo,
                  maxAge: n.maxAge.baseValue,
                }
              : {
                  type: 'retirementDateSpecified',
                  currentAgeInfo,
                  retirementAge: n.retirement.ageIfInFuture.baseValue,
                  maxAge: n.maxAge.baseValue,
                },
        }
      }
      return norm.ages.person2
        ? {
            withPartner: true,
            person1: _getPerson(norm.ages.person1),
            person2: _getPerson(norm.ages.person2),
            withdrawalStart:
              norm.ages.simulationMonths.withdrawalStartMonth.atRetirementOf,
          }
        : {
            withPartner: false,
            person1: _getPerson(norm.ages.person1),
          }
    }),
    wealth: {
      portfolioBalance: norm.wealth.portfolioBalance,
      futureSavings: _forLabeledAmountTimedList(norm.wealth.futureSavings),
      incomeDuringRetirement: _forLabeledAmountTimedList(
        norm.wealth.incomeDuringRetirement,
      ),
    },
    adjustmentsToSpending: {
      extraSpending: {
        essential: _forLabeledAmountTimedList(
          norm.adjustmentsToSpending.extraSpending.essential,
        ),
        discretionary: _forLabeledAmountTimedList(
          norm.adjustmentsToSpending.extraSpending.discretionary,
        ),
      },
      tpawAndSPAW: {
        monthlySpendingCeiling:
          norm.adjustmentsToSpending.tpawAndSPAW.monthlySpendingCeiling,
        monthlySpendingFloor:
          norm.adjustmentsToSpending.tpawAndSPAW.monthlySpendingFloor,
        legacy: {
          total: norm.adjustmentsToSpending.tpawAndSPAW.legacy.total,
          external: _.fromPairs(
            norm.adjustmentsToSpending.tpawAndSPAW.legacy.external.map((x) => [
              x.id,
              x,
            ]),
          ),
        },
      },
    },
    risk: {
      tpaw: norm.risk.tpaw,
      tpawAndSPAW: norm.risk.tpawAndSPAW,
      spaw: norm.risk.spaw,
      spawAndSWR: {
        allocation: normalizeGlidePath.inverse(
          norm.risk.spawAndSWR.allocation,
          norm.datingInfo.nowAsCalendarDay,
        ),
      },
      swr: norm.risk.swr,
    },
    advanced: norm.advanced,
    results: norm.results,
  }
}
