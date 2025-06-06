import { faCircle as faCircleRegular } from '@fortawesome/pro-regular-svg-icons'
import { faCircle as faCircleSelected } from '@fortawesome/pro-solid-svg-icons'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  PLAN_PARAMS_CONSTANTS,
  PlanParams,
  fGet,
  getNYZonedTime,
  noCase,
  partialDefaultDatelessPlanParams,
} from '@tpaw/common'
import { DateTime } from 'luxon'
import React from 'react'
import { PlanParamsNormalized } from '@tpaw/common'
import { formatPercentage } from '../../../../Utils/FormatPercentage'
import { paddingCSS } from '../../../../Utils/Geometry'
import { SliderInput } from '../../../Common/Inputs/SliderInput/SliderInput'
import {
  useSimulationInfo,
  useSimulationResultInfo,
} from '../../PlanRootHelpers/WithSimulation'
import { PlanInputModifiedBadge } from './Helpers/PlanInputModifiedBadge'
import {
  PlanInputBody,
  PlanInputBodyPassThruProps,
} from './PlanInputBody/PlanInputBody'
import {
  inflationTypeLabel,
  useIsPlanInputInflationModified,
} from './PlanInputInflationFns'
import { CalendarDayFns } from '@tpaw/common'
import { mainPlanColors } from '../UsePlanColors'

export const PlanInputInflation = React.memo(
  (props: PlanInputBodyPassThruProps) => {
    return (
      <PlanInputBody {...props}>
        <_InflationCard className="" props={props} />
      </PlanInputBody>
    )
  },
)

export const _InflationCard = React.memo(
  ({
    className = '',
    props,
  }: {
    className?: string
    props: PlanInputBodyPassThruProps
  }) => {
    const { planParamsNormInstant, updatePlanParams } = useSimulationInfo()
    const { simulationResult } = useSimulationResultInfo()
    const planParamsProcessed = simulationResult.planParamsProcessed

    const handleChange = (
      annualInflation: PlanParams['advanced']['annualInflation'],
    ) => updatePlanParams('setAnnualInflation', annualInflation)

    const isModified = useIsPlanInputInflationModified()

    return (
      <div
        className={`${className} params-card relative`}
        style={{ padding: paddingCSS(props.sizing.cardPadding) }}
      >
        <PlanInputModifiedBadge show={isModified} mainPage={false} />

        {planParamsNormInstant.datingInfo.isDated ? (
          <>
            <p className="p-base mt-2">
              Enter your estimate for the annual inflation rate. The{' '}
              {`"${inflationTypeLabel({ type: 'suggested' })}"`} option will be
              automatically updated based on new data.
            </p>
            <p className="p-base mt-2">
              The current inflation data is from NYSE close on{' '}
              {_formatNYDate(
                planParamsProcessed.marketDataForPresets.sourceRounded
                  .dailyMarketData.inflation.closingTimestamp,
              )}
              .
            </p>
          </>
        ) : (
          <>
            <p className="p-base mt-2">
              Enter your estimate for the annual inflation rate. The{' '}
              {`"${inflationTypeLabel({ type: 'suggested' })}"`} option is
              calculated based on market data.
            </p>
            <p className="p-base mt-2">
              This is a dateless plan and you have chosen to use market data as
              of{' '}
              {CalendarDayFns.toStr(
                planParamsNormInstant.datingInfo.marketDataAsOfEndOfDayInNY,
              )}
              . The latest inflation data available on that day was from NYSE
              close on{' '}
              {_formatNYDate(
                planParamsProcessed.marketDataForPresets.sourceRounded
                  .dailyMarketData.inflation.closingTimestamp,
              )}
              .
            </p>
          </>
        )}

        <button
          className={`${className} flex gap-x-2 mt-4`}
          onClick={() => handleChange({ type: 'suggested' })}
        >
          <FontAwesomeIcon
            className="mt-1"
            icon={
              planParamsNormInstant.advanced.annualInflation.type ===
              'suggested'
                ? faCircleSelected
                : faCircleRegular
            }
          />
          <div className="">
            <h2 className="text-start">
              {inflationTypeLabel({ type: 'suggested' })}
              <span
                className="hidden sm:inline-block px-2 bg-gray-200 rounded-full text-sm ml-2"
                style={{
                  backgroundColor: mainPlanColors.shades.light[4].hex,
                }}
              >
                default
              </span>
            </h2>
            <h2 className="text-left text-sm lighten-2">
              {formatPercentage(1)(
                planParamsProcessed.marketDataForPresets.inflation
                  .suggestedAnnual,
              )}
            </h2>
          </div>
        </button>

        <button
          className={`${className} flex gap-x-2 mt-3`}
          onClick={() => {
            switch (planParamsNormInstant.advanced.annualInflation.type) {
              case 'suggested':
                handleChange({
                  type: 'manual',
                  value: fGet(
                    planParamsProcessed.marketDataForPresets.inflation
                      .suggestedAnnual,
                  ),
                })
                break
              case 'manual':
                return
              default:
                noCase(planParamsNormInstant.advanced.annualInflation)
            }
          }}
        >
          <FontAwesomeIcon
            className="mt-1"
            icon={
              planParamsNormInstant.advanced.annualInflation.type === 'manual'
                ? faCircleSelected
                : faCircleRegular
            }
          />
          <div className="">
            <h2 className="text-start">
              {inflationTypeLabel({ type: 'manual' })}
            </h2>
          </div>
        </button>
        {planParamsNormInstant.advanced.annualInflation.type === 'manual' && (
          <SliderInput
            className=""
            height={60}
            maxOverflowHorz={props.sizing.cardPadding}
            format={formatPercentage(1)}
            data={PLAN_PARAMS_CONSTANTS.advanced.inflation.manual.values}
            value={planParamsNormInstant.advanced.annualInflation.value}
            onChange={(value) => handleChange({ type: 'manual', value })}
            ticks={(value, i) =>
              i % 10 === 0
                ? ('large' as const)
                : i % 2 === 0
                  ? ('small' as const)
                  : ('none' as const)
            }
          />
        )}
        <button
          className="mt-6 underline disabled:lighten-2"
          onClick={() =>
            handleChange(
              partialDefaultDatelessPlanParams.advanced.annualInflation,
            )
          }
          disabled={!isModified}
        >
          Reset to Default
        </button>
      </div>
    )
  },
)

export const PlanInputInflationSummary = React.memo(
  ({ planParamsNorm }: { planParamsNorm: PlanParamsNormalized }) => {
    const { simulationResult } = useSimulationResultInfo()
    const { planParamsProcessed } = simulationResult
    return (
      <h2>
        {inflationTypeLabel(planParamsNorm.advanced.annualInflation)}:{' '}
        {formatPercentage(1)(planParamsProcessed.annualInflation)}
      </h2>
    )
  },
)
const _formatNYDate = (timestamp: number) =>
  getNYZonedTime(timestamp).toLocaleString(DateTime.DATE_MED)
