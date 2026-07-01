import {
	Address,
	log,
} from '@graphprotocol/graph-ts'

import {
	ERC20Transfer,
} from '../generated/schema'

import {
	Transfer as TransferEvent,
} from '../generated/templates/EIP20/IERC20'

import {
	decimals,
	events,
	transactions,
} from '@amxx/graphprotocol-utils'

import {
	Account,
	ERC20Contract,
	ERC20Balance,
} from '../generated/schema'

import {
	IERC20,
} from '../generated/templates/EIP20/IERC20'

import {
	constants,
} from '@amxx/graphprotocol-utils'

const DEFAULT_DECIMALS = 18
const MAX_DECIMALS = 36 // safe cap for BigDecimal math

function normalizeDecimals(dec: i32): i32 {
  if (dec < 0) return 0
  if (dec > MAX_DECIMALS) {
    log.warning('Capping absurd decimals {} to {}', [dec.toString(), MAX_DECIMALS.toString()])
    return MAX_DECIMALS
  }
  return dec
}

export function fetchAccount(address: Address): Account {
	let account = new Account(address)
	account.save()
	return account
}

export function fetchERC20(address: Address): ERC20Contract {
	let contract = ERC20Contract.load(address)

	if (contract == null) {
		let endpoint         = IERC20.bind(address)
		let name             = endpoint.try_name()
		let symbol           = endpoint.try_symbol()
		let decimals         = endpoint.try_decimals()

		// Common
		contract             = new ERC20Contract(address)
		contract.name        = name.reverted     ? null : name.value
		contract.symbol      = symbol.reverted   ? null : symbol.value
		contract.decimals    = decimals.reverted ? DEFAULT_DECIMALS   : normalizeDecimals(decimals.value)
		contract.totalSupply = fetchERC20Balance(contract as ERC20Contract, null).id
		contract.asAccount   = address
		contract.save()

		let account          = fetchAccount(address)
		account.asERC20      = address
		account.save()
	}

	return contract as ERC20Contract
}

export function fetchERC20Balance(contract: ERC20Contract, account: Account | null): ERC20Balance {
	let id      = contract.id.toHex().concat('/').concat(account ? account.id.toHex() : 'totalSupply')
	let balance = ERC20Balance.load(id)

	if (balance == null) {
		balance                 = new ERC20Balance(id)
		balance.contract        = contract.id
		balance.account         = account ? account.id : null
		balance.value           = constants.BIGDECIMAL_ZERO
		balance.valueExact      = constants.BIGINT_ZERO
		balance.save()
	}

	return balance as ERC20Balance
}

export function handleTransfer(event: TransferEvent): void {
	let contract   = fetchERC20(event.address)
	let ev         = new ERC20Transfer(events.id(event))
	ev.emitter     = contract.id
	ev.transaction = transactions.log(event).id
	ev.timestamp   = event.block.timestamp
	ev.contract    = contract.id
	ev.value       = decimals.toDecimals(event.params.value, contract.decimals)
	ev.valueExact  = event.params.value

	if (event.params.from == Address.zero()) {
		let totalSupply        = fetchERC20Balance(contract, null)
		totalSupply.valueExact = totalSupply.valueExact.plus(event.params.value)
		totalSupply.value      = decimals.toDecimals(totalSupply.valueExact, contract.decimals)
		totalSupply.save()
	} else {
		let from               = fetchAccount(event.params.from)
		let balance            = fetchERC20Balance(contract, from)
		balance.valueExact     = balance.valueExact.minus(event.params.value)
		balance.value          = decimals.toDecimals(balance.valueExact, contract.decimals)
		balance.save()

		ev.from                = from.id
		ev.fromBalance         = balance.id
	}

	if (event.params.to == Address.zero()) {
		let totalSupply        = fetchERC20Balance(contract, null)
		totalSupply.valueExact = totalSupply.valueExact.minus(event.params.value)
		totalSupply.value      = decimals.toDecimals(totalSupply.valueExact, contract.decimals)
		totalSupply.save()
	} else {
		let to                 = fetchAccount(event.params.to)
		let balance            = fetchERC20Balance(contract, to)
		balance.valueExact     = balance.valueExact.plus(event.params.value)
		balance.value          = decimals.toDecimals(balance.valueExact, contract.decimals)
		balance.save()

		ev.to                  = to.id
		ev.toBalance           = balance.id
	}
	ev.save()
}